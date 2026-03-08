/*
 * File: server.js
 * Module: packages/collaboration (协作服务端)
 *
 * Responsibility:
 *   - 为 CodeMirror + Yjs 提供兼容 `y-websocket` 的实时协作服务端。
 *   - 管理文档房间、连接生命周期、Awareness 广播和协作状态持久化。
 *
 * Runtime Logic Overview:
 *   1. API 进程在启动时挂载 WebSocket upgrade 处理器。
 *   2. 客户端按 `projectId + fileId` 进入协作房间，并完成 Yjs 同步握手。
 *   3. 文档更新实时广播给其他连接，并周期性写回项目文件与 Yjs 状态快照。
 *
 * Dependencies:
 *   - ws
 *   - yjs
 *   - y-protocols
 *   - lib0
 *   - packages/runtime-store/collaboration
 *
 * Last Updated:
 *   - 2026-03-08 by Codex - 升级为 fileId 协作主键并保留正式 cookie 会话认证
 */

import { WebSocketServer } from "ws";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import { authenticateRequest } from "../../authentication/src/service.js";
import {
  ensureCollaborationStorage,
  loadCollaborativeDocument,
  persistCollaborativeDocument,
} from "../../runtime-store/src/collaboration.js";
import { requireProjectAccess } from "../../runtime-store/src/projects.js";
import { ensureUserProfile } from "../../runtime-store/src/users.js";

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;
const collaborationPathPrefix = "/api/collaboration/";
const roomIdleTtlMs = 30_000;
const persistDebounceMs = 750;
const allowDemoAuth = process.env.ALLOW_DEMO_AUTH === "1";

function createSyncStep1Message(doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

function createSyncUpdateMessage(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function createAwarenessMessage(awareness, clientIds) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageAwareness);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clientIds),
  );
  return encoding.toUint8Array(encoder);
}

function parseRoomName(roomName) {
  const separator = "::";
  const separatorIndex = roomName.indexOf(separator);

  if (separatorIndex <= 0) {
    throw new Error("协作房间名非法");
  }

  const projectId = roomName.slice(0, separatorIndex);
  const fileId = roomName.slice(separatorIndex + separator.length);

  if (!projectId || !fileId) {
    throw new Error("协作房间参数不完整");
  }

  return { projectId, fileId };
}

function readAwarenessClientIds(update) {
  const decoder = decoding.createDecoder(update);
  const length = decoding.readVarUint(decoder);
  const entries = [];

  for (let index = 0; index < length; index += 1) {
    const clientId = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder));
    entries.push({ clientId, state });
  }

  return entries;
}

function sendBinary(client, payload) {
  if (client.readyState === client.OPEN) {
    client.send(payload);
  }
}

export function createCollaborationServer() {
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map();

  async function getOrCreateRoom(roomName) {
    const existingRoom = rooms.get(roomName);

    if (existingRoom) {
      return existingRoom;
    }

    const { projectId, fileId } = parseRoomName(roomName);
    const loadedDocument = await loadCollaborativeDocument(projectId, fileId);
    const doc = new Y.Doc();
    const ytext = doc.getText("content");

    if (loadedDocument.stateUpdate) {
      Y.applyUpdate(doc, new Uint8Array(loadedDocument.stateUpdate));
    } else if (loadedDocument.content) {
      ytext.insert(0, loadedDocument.content);
    }

    const awareness = new awarenessProtocol.Awareness(doc);
    const room = {
      name: roomName,
      projectId,
      fileId,
      filePath: loadedDocument.path,
      doc,
      awareness,
      clients: new Set(),
      persistTimer: null,
      destroyTimer: null,
      persistPromise: Promise.resolve(),
      flush: async () => {
        const content = ytext.toString();
        const stateUpdate = Y.encodeStateAsUpdate(doc);
        room.persistPromise = persistCollaborativeDocument(projectId, fileId, {
          content,
          stateUpdate,
        });
        await room.persistPromise;
      },
      schedulePersist: () => {
        if (room.persistTimer) {
          clearTimeout(room.persistTimer);
        }

        room.persistTimer = setTimeout(() => {
          room.persistTimer = null;
          void room.flush().catch((error) => {
            console.error(`Collaboration persist failed for ${room.name}:`, error);
          });
        }, persistDebounceMs);
      },
      scheduleDestroy: () => {
        if (room.destroyTimer) {
          clearTimeout(room.destroyTimer);
        }

        room.destroyTimer = setTimeout(() => {
          if (room.clients.size > 0) {
            return;
          }

          cleanupRoom(room);
        }, roomIdleTtlMs);
      },
    };

    doc.on("update", (update, origin) => {
      const payload = createSyncUpdateMessage(update);

      for (const client of room.clients) {
        if (client !== origin) {
          sendBinary(client, payload);
        }
      }

      room.schedulePersist();
    });

    awareness.on("update", ({ added, updated, removed }, origin) => {
      const changedClients = [...added, ...updated, ...removed];

      if (changedClients.length === 0) {
        return;
      }

      const payload = createAwarenessMessage(awareness, changedClients);

      for (const client of room.clients) {
        if (client !== origin) {
          sendBinary(client, payload);
        }
      }
    });

    rooms.set(roomName, room);
    return room;
  }

  async function cleanupRoom(room) {
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }

    if (room.destroyTimer) {
      clearTimeout(room.destroyTimer);
      room.destroyTimer = null;
    }

    try {
      await room.flush();
    } catch (error) {
      console.error(`Failed to flush collaboration room ${room.name} on cleanup:`, error);
    }

    room.awareness.destroy();
    room.doc.destroy();
    rooms.delete(room.name);
  }

  function handleMessage(room, client, rawMessage) {
    const message = new Uint8Array(rawMessage);
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === messageSync) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);

      if (encoding.length(encoder) > 1) {
        sendBinary(client, encoding.toUint8Array(encoder));
      }

      return;
    }

    if (messageType === messageQueryAwareness) {
      const clientIds = Array.from(room.awareness.getStates().keys());
      sendBinary(client, createAwarenessMessage(room.awareness, clientIds));
      return;
    }

    if (messageType === messageAwareness) {
      const update = decoding.readVarUint8Array(decoder);
      const awarenessEntries = readAwarenessClientIds(update);

      for (const entry of awarenessEntries) {
        if (entry.state === null) {
          client.awarenessClientIds.delete(entry.clientId);
        } else {
          client.awarenessClientIds.add(entry.clientId);
        }
      }

      awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client);
    }
  }

  async function attachClient(room, client) {
    room.clients.add(client);

    if (room.destroyTimer) {
      clearTimeout(room.destroyTimer);
      room.destroyTimer = null;
    }

    client.awarenessClientIds = new Set();
    client.binaryType = "arraybuffer";
    sendBinary(client, createSyncStep1Message(room.doc));

    const existingAwarenessIds = Array.from(room.awareness.getStates().keys());

    if (existingAwarenessIds.length > 0) {
      sendBinary(client, createAwarenessMessage(room.awareness, existingAwarenessIds));
    }

    client.on("message", (message) => {
      try {
        handleMessage(room, client, message);
      } catch (error) {
        console.error(`Collaboration message failed for ${room.name}:`, error);
      }
    });

    client.on("close", () => {
      room.clients.delete(client);

      if (client.awarenessClientIds.size > 0) {
        awarenessProtocol.removeAwarenessStates(
          room.awareness,
          Array.from(client.awarenessClientIds),
          client,
        );
      }

      if (room.clients.size === 0) {
        room.scheduleDestroy();
      }
    });
  }

  return {
    async handleUpgrade(request, socket, head) {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (!url.pathname.startsWith(collaborationPathPrefix)) {
        socket.destroy();
        return false;
      }

      await ensureCollaborationStorage();
      const roomName = decodeURIComponent(url.pathname.slice(collaborationPathPrefix.length));
      const authenticated = await authenticateRequest(request);
      const currentUser =
        authenticated?.user ??
        (allowDemoAuth
          ? await ensureUserProfile({
              id: url.searchParams.get("userId") ?? "local-default-user",
              name: url.searchParams.get("userName") ?? "本地作者",
            })
          : null);

      try {
        if (!currentUser) {
          throw new Error("协作连接未登录");
        }

        const { projectId } = parseRoomName(roomName);
        await requireProjectAccess(projectId, currentUser);
        const room = await getOrCreateRoom(roomName);
        wss.handleUpgrade(request, socket, head, (client) => {
          void attachClient(room, client);
        });
        return true;
      } catch (error) {
        console.error("Failed to open collaboration room:", error);
        socket.destroy();
        return false;
      }
    },
    getRoomCount() {
      return rooms.size;
    },
  };
}

/*
 * Code Review:
 * - 当前服务端直接实现了 `y-websocket` 兼容协议，避免再引入单独协作进程，优先完成完整协作闭环。
 * - 文档状态以房间级 debounce 持久化到仓储层，兼顾输入实时性和磁盘写入频率。
 * - 协作握手已切到 cookie 会话认证，避免仅靠查询参数声明身份带来的越权风险。
 * - 房间名当前由 `projectId + filePath` 编码组成，后续若引入权限系统，应继续保持 upgrade 阶段先鉴权再入房间。
 */
