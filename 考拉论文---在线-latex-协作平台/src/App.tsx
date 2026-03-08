import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  Share2, 
  Bell, 
  Settings, 
  FileText, 
  FolderOpen, 
  Folder, 
  BookOpen, 
  FileJson, 
  Plus, 
  List, 
  History, 
  Play, 
  ZoomIn, 
  ZoomOut, 
  Download, 
  Cloud,
  Check,
  Bold,
  Italic,
  ListIcon,
  Undo2,
  Redo2,
  ChevronRight,
  ChevronDown,
  FileCode,
  Search as SearchIcon,
  FlaskConical,
  Brain,
  Terminal,
  Bookmark,
  Calendar,
  Quote,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

type ViewType = 'discovery' | 'workbench';

interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  icon?: React.ReactNode;
  children?: FileItem[];
  isOpen?: boolean;
}

interface TOCItem {
  id: string;
  number?: string;
  title: string;
  level: number;
}

interface ReferenceItem {
  id: string;
  name: string;
  status: string;
}

interface ToneItem {
  id: string;
  name: string;
  content: string;
}

// --- Mock Data ---

const initialFiles: FileItem[] = [
  { id: 'main', name: 'main.tex', type: 'file', icon: <FileCode className="w-4 h-4 text-primary" /> },
  { 
    id: 'chapters', 
    name: 'chapters/', 
    type: 'folder', 
    isOpen: true,
    children: [
      { id: 'intro', name: 'intro.tex', type: 'file', icon: <FileText className="w-4 h-4 text-slate-400" /> },
      { id: 'method', name: 'method.tex', type: 'file', icon: <FileText className="w-4 h-4 text-slate-400" /> },
    ]
  },
  { id: 'images', name: 'images/', type: 'folder', icon: <Folder className="w-4 h-4 text-slate-400" /> },
  { id: 'refs', name: 'references.bib', type: 'file', icon: <BookOpen className="w-4 h-4 text-slate-400" /> },
  { id: 'settings', name: 'settings.json', type: 'file', icon: <Settings className="w-4 h-4 text-slate-400" /> },
];

const tocData: TOCItem[] = [
  { id: 'intro', number: '1', title: 'Introduction', level: 0 },
  { id: 'method', number: '2', title: 'Methodology', level: 0 },
  { id: 'sys-model', title: 'System Model', level: 1 },
  { id: 'experiments', number: '3', title: 'Experiments', level: 0 },
  { id: 'conclusion', number: '4', title: 'Conclusion', level: 0 },
];

const references: ReferenceItem[] = [
  { id: 'ref1', name: 'Transformer_Paper.pdf', status: '协作共享资源' },
  { id: 'ref2', name: 'Efficient_Attention.pdf', status: '协作共享资源' },
];

const initialTone: ToneItem = {
  id: 'proposal',
  name: '开题报告.docx',
  content: '这里是论文的开题报告内容，将作为 AI 写作的基调参考...'
};

const discoveryPapers = [
  {
    id: 'p1',
    title: 'Deep Residual Learning for Image Recognition: A Comprehensive Survey',
    authors: 'He, K., Zhang, X., Ren, S., & Sun, J.',
    date: '2023年3月15日',
    citations: '2.45万',
    pages: '12',
    tags: ['已读', '高引用', 'Nature 2023'],
    abstract: 'Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously. We explicitly reformulate the layers as learning residual functions with reference to the layer inputs, instead of learning unreferenced functions. We provide comprehensive empirical evidence showing that these residual networks are easier to optimize, and can gain accuracy from considerably increased depth...'
  },
  {
    id: 'p2',
    title: 'Attention Is All You Need: Large Language Models in Review',
    authors: 'Vaswani, A., Shazeer, N., Parmar, N., et al.',
    date: '2017年6月12日',
    citations: '8.9万',
    tags: ['经典', 'Transformer'],
    abstract: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks in an encoder-decoder configuration. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely...'
  },
  {
    id: 'p3',
    title: 'Optimizing Multi-Modal Alignment in Latent Diffusion Spaces',
    authors: 'Ramesh, A., Dhariwal, P., Nichol, A., et al.',
    date: 'Oct 02, 2024',
    citations: '120',
    tags: ['ICML 2024', '最新'],
    abstract: 'Multi-modal alignment remains a core challenge in generative AI. We explore novel techniques for aligning text and image embeddings within latent diffusion spaces, achieving state-of-the-art performance on zero-shot benchmarks...'
  }
];

// --- Components ---

function FileTreeItem({ item, depth = 0 }: { item: FileItem; depth?: number; key?: React.Key }) {
  const [isOpen, setIsOpen] = useState(item.isOpen);

  return (
    <div>
      <div 
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
          item.id === 'main' ? 'bg-primary/10 text-primary' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
        }`}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        onClick={() => item.type === 'folder' && setIsOpen(!isOpen)}
      >
        {item.type === 'folder' ? (
          isOpen ? <FolderOpen className="w-4 h-4 text-slate-400" /> : <Folder className="w-4 h-4 text-slate-400" />
        ) : (
          item.icon || <FileText className="w-4 h-4" />
        )}
        <span className="text-sm font-medium">{item.name}</span>
      </div>
      {item.type === 'folder' && isOpen && item.children && (
        <div className="mt-0.5">
          {item.children.map(child => (
            <FileTreeItem key={child.id} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('workbench');
  const [rightTab, setRightTab] = useState<'pdf' | 'tone' | 'ref'>('pdf');
  const [selectedPaper, setSelectedPaper] = useState(discoveryPapers[0]);
  const [isCompiling, setIsCompiling] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isFitWidth, setIsFitWidth] = useState(true);
  const [activeSection, setActiveSection] = useState<string | null>('method');
  const [cursorPos, setCursorPos] = useState({ top: 310, left: 142 });
  const editorRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  // Simulate collaborator cursor movement
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorPos(prev => ({
        top: prev.top + (Math.random() > 0.5 ? 1 : -1),
        left: prev.left + (Math.random() > 0.5 ? 1 : -1)
      }));
    }, 200);
    
    // Occasionally move to a different line
    const jumpInterval = setInterval(() => {
      const lines = [310, 336, 518, 622];
      const randomLine = lines[Math.floor(Math.random() * lines.length)];
      setCursorPos({
        top: randomLine,
        left: 142 + Math.random() * 100
      });
    }, 10000);

    return () => {
      clearInterval(interval);
      clearInterval(jumpInterval);
    };
  }, []);

  const [code, setCode] = useState(`\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}

\\title{Quantum Cryptography in
Distributed Networks}
\\author{Research Team Alpha}
\\date{October 2023}

\\begin{document}

\\maketitle

\\section{Introduction}
The security of modern communication
networks relies heavily on the
distribution of secret keys.
Quantum key distribution (QKD) offers a
provably secure alternative based on
the laws of physics.

\\section{Methodology}
We analyze a BB84 protocol implementation
over a star network topology. The
experimental setup consists of Alice
(transmitter) and Bob (receiver)
connected via a 50km standard
single-mode fiber (SMF-28).

\\section{Experiments}
Our results show a stable key rate of
1.2 kbps over the entire distance.
The quantum bit error rate (QBER)
remained below 3% throughout the
measurement period.

\\section{Conclusion}
We have demonstrated a robust QKD
system integrated into distributed
networks. Future work will focus on
multi-node routing and dynamic
resource allocation.

\\end{document}`);

  const handleCompile = () => {
    setIsCompiling(true);
    setTimeout(() => setIsCompiling(false), 1500);
  };

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    
    // Scroll Editor
    const sectionLineMap: Record<string, number> = {
      'intro': 14,
      'method': 22,
      'experiments': 31,
      'conclusion': 38
    };

    if (editorRef.current) {
      const lineHeight = 26;
      const targetScroll = (sectionLineMap[sectionId] - 1) * lineHeight;
      editorRef.current.scrollTo({ top: targetScroll - 100, behavior: 'smooth' });
    }

    // Scroll PDF
    const pdfSection = document.getElementById(`pdf-${sectionId}`);
    if (pdfSection && pdfRef.current) {
      pdfSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleZoomIn = () => {
    setIsFitWidth(false);
    setZoom(prev => Math.min(prev + 0.1, 2));
  };

  const handleZoomOut = () => {
    setIsFitWidth(false);
    setZoom(prev => Math.max(prev - 0.1, 0.5));
  };

  const toggleFitWidth = () => {
    setIsFitWidth(!isFitWidth);
    if (!isFitWidth) setZoom(1);
  };

  return (
    <div className="flex flex-col h-screen bg-preview-bg text-ink overflow-hidden font-sans">
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-6 bg-sidebar border-b border-stone-200 shrink-0 z-50">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center text-white shadow-sm shadow-accent/20">
              <span className="font-bold text-lg">K</span>
            </div>
            <h1 className="text-lg font-bold tracking-tight text-ink">考拉论文</h1>
          </div>
          <nav className="flex items-center gap-6">
            <button 
              onClick={() => setCurrentView('discovery')}
              className={`text-sm font-medium transition-colors relative py-4 ${currentView === 'discovery' ? 'text-accent font-bold' : 'text-ink-muted hover:text-accent'}`}
            >
              探索
              {currentView === 'discovery' && <motion.div layoutId="nav-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
            </button>
            <button 
              onClick={() => setCurrentView('workbench')}
              className={`text-sm font-medium transition-colors relative py-4 ${currentView === 'workbench' ? 'text-accent font-bold' : 'text-ink-muted hover:text-accent'}`}
            >
              写作工作台
              {currentView === 'workbench' && <motion.div layoutId="nav-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
            </button>
          </nav>
        </div>

        {/* Global Search - More prominent in Discovery */}
        <div className="flex-1 max-w-xl mx-8">
          <div className="relative group">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 group-focus-within:text-accent transition-colors" />
            <input 
              type="text" 
              placeholder="搜索超过2亿篇论文、作者或主题..."
              className="w-full bg-stone-100 border-none rounded-full py-1.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-accent/20 transition-all outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center -space-x-2 mr-2">
            <div className="w-8 h-8 rounded-full border-2 border-white bg-blue-500 flex items-center justify-center text-[10px] text-white font-bold ring-2 ring-transparent hover:ring-accent transition-all cursor-pointer">JD</div>
            <div className="w-8 h-8 rounded-full border-2 border-white bg-emerald-500 flex items-center justify-center text-[10px] text-white font-bold ring-2 ring-transparent hover:ring-emerald-400 transition-all cursor-pointer">42</div>
            <div className="w-8 h-8 rounded-full border-2 border-white bg-amber-500 flex items-center justify-center text-[10px] text-white font-bold ring-2 ring-transparent hover:ring-amber-400 transition-all cursor-pointer">A</div>
          </div>
          
          <button className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-bold hover:bg-accent-hover transition-all shadow-sm shadow-accent/10">
            <Share2 className="w-4 h-4" />
            分享
          </button>

          <div className="flex items-center gap-1">
            <button className="p-2 text-ink-muted hover:bg-stone-100 rounded-lg transition-colors">
              <Bell className="w-5 h-5" />
            </button>
            <button className="p-2 text-ink-muted hover:bg-stone-100 rounded-lg transition-colors">
              <Settings className="w-5 h-5" />
            </button>
          </div>

          <div className="w-9 h-9 rounded-full bg-stone-200 border border-stone-300 overflow-hidden cursor-pointer">
            <img src="https://picsum.photos/seed/user/100/100" alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {currentView === 'workbench' ? (
            <motion.div 
              key="workbench"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-1 overflow-hidden"
            >
              {/* Left Sidebar */}
              <aside className="w-64 flex flex-col border-r border-stone-200 bg-sidebar shrink-0">
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {/* Project Files */}
                  <section className="p-4">
                    <div className="flex items-center justify-between mb-3 px-1">
                      <h3 className="text-[11px] font-bold text-stone-400 uppercase tracking-widest">项目文件</h3>
                      <button className="text-accent hover:bg-accent/10 p-1 rounded transition-colors">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {initialFiles.map(file => (
                        <FileTreeItem key={file.id} item={file} />
                      ))}
                    </div>
                  </section>

                  {/* TOC */}
                  <section className="p-4 pt-0">
                    <div className="flex items-center justify-between mb-3 px-1 border-t border-stone-100 pt-4">
                      <h3 className="text-[11px] font-bold text-stone-400 uppercase tracking-widest">目录大纲</h3>
                      <button className="text-stone-400 hover:text-accent p-1 rounded transition-colors">
                        <List className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {tocData.map(item => (
                        <div 
                          key={item.id} 
                          onClick={() => scrollToSection(item.id)}
                          className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors group ${
                            activeSection === item.id 
                              ? 'bg-accent/10 text-accent' 
                              : 'hover:bg-stone-50 text-ink-muted'
                          } ${item.level > 0 ? 'ml-4' : ''}`}
                        >
                          {item.number ? (
                            <span className={`w-4 text-[10px] font-bold ${activeSection === item.id ? 'text-accent' : 'text-stone-400 group-hover:text-accent'}`}>{item.number}</span>
                          ) : (
                            <div className={`w-1.5 h-1.5 rounded-full ${activeSection === item.id ? 'bg-accent' : 'bg-stone-300 group-hover:bg-accent'} ml-1`} />
                          )}
                          <span className="group-hover:text-accent">{item.title}</span>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* References */}
                  <section className="p-4 pt-0">
                    <div className="flex items-center justify-between mb-3 px-1 border-t border-stone-100 pt-4">
                      <h3 className="text-[11px] font-bold text-accent uppercase tracking-widest">参考论文</h3>
                      <button className="text-accent hover:bg-accent/10 p-1 rounded transition-colors">
                        <BookOpen className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {references.map(ref => (
                        <div 
                          key={ref.id} 
                          onClick={() => {
                            setRightTab('ref');
                            // In a real app, we'd fetch the abstract for this ref
                            setSelectedPaper({
                              ...discoveryPapers[0],
                              title: ref.name,
                              authors: '协作共享资源'
                            });
                          }}
                          className="p-2 rounded-lg bg-stone-50 border border-stone-100 hover:border-accent/30 transition-all cursor-pointer group"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="w-4 h-4 text-red-500/70" />
                            <span className="text-xs font-medium text-ink truncate group-hover:text-accent">{ref.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 ml-6">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span className="text-[9px] font-medium text-stone-400 uppercase">{ref.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                {/* Status Footer */}
                <div className="p-4 bg-stone-50 border-t border-stone-200">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg relative">
                      <Cloud className="w-4 h-4" />
                      <Check className="w-2 h-2 absolute bottom-1 right-1 bg-emerald-100 rounded-full" />
                    </div>
                    <div>
                      <p className="text-[9px] font-bold text-stone-400 uppercase">状态</p>
                      <p className="text-xs font-semibold text-ink">同步完成</p>
                    </div>
                  </div>
                </div>
              </aside>

              {/* Editor Area */}
              <section className="flex-1 flex flex-col bg-editor-bg relative overflow-hidden">
                {/* Editor Toolbar */}
                <div className="h-12 flex items-center justify-between px-4 bg-stone-50 border-b border-stone-200 shrink-0">
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 text-stone-400 hover:text-ink hover:bg-stone-200 rounded transition-colors"><Bold className="w-4 h-4" /></button>
                    <button className="p-1.5 text-stone-400 hover:text-ink hover:bg-stone-200 rounded transition-colors"><Italic className="w-4 h-4" /></button>
                    <button className="p-1.5 text-stone-400 hover:text-ink hover:bg-stone-200 rounded transition-colors"><ListIcon className="w-4 h-4" /></button>
                    <div className="w-px h-5 bg-stone-200 mx-2" />
                    <button className="p-1.5 text-stone-400 hover:text-ink hover:bg-stone-200 rounded transition-colors"><Undo2 className="w-4 h-4" /></button>
                    <button className="p-1.5 text-stone-400 hover:text-ink hover:bg-stone-200 rounded transition-colors"><Redo2 className="w-4 h-4" /></button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 text-ink-muted border border-stone-200 rounded-lg text-xs font-bold hover:bg-stone-200 transition-all">
                      <History className="w-3.5 h-3.5" />
                      历史
                    </button>
                    <button 
                      onClick={handleCompile}
                      disabled={isCompiling}
                      className={`flex items-center gap-2 px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-bold shadow-sm shadow-accent/20 transition-all ${isCompiling ? 'opacity-70 cursor-not-allowed' : 'hover:bg-accent-hover'}`}
                    >
                      {isCompiling ? (
                        <motion.div 
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </motion.div>
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                      编译
                    </button>
                  </div>
                </div>

                {/* Code Editor Content */}
                <div 
                  ref={editorRef}
                  className="flex-1 overflow-auto custom-scrollbar bg-editor-bg flex group scroll-smooth"
                >
                  {/* Line Numbers - Sticky */}
                  <div className="sticky left-0 top-0 h-fit flex flex-col text-stone-400 text-right pr-4 select-none opacity-60 bg-editor-bg py-6 shrink-0 z-30 border-r border-stone-100">
                    {code.split('\n').map((_, i) => (
                      <div key={i} className="h-[26px] leading-[26px] min-w-[2rem]">{i + 1}</div>
                    ))}
                  </div>
                  
                  {/* Editor Wrapper - This defines the scrollable area */}
                  <div className="flex-1 relative grid min-w-0">
                    {/* Syntax Highlighting Layer - This pushes the height */}
                    <div 
                      className="row-start-1 col-start-1 p-6 whitespace-pre-wrap break-words text-ink font-mono text-sm leading-[26px] pointer-events-none z-10"
                      aria-hidden="true"
                    >
                      {code.split('\n').map((line, i) => {
                        const isHighlighted = (activeSection === 'intro' && i + 1 === 14) ||
                                             (activeSection === 'method' && i + 1 === 22) ||
                                             (activeSection === 'experiments' && i + 1 === 31) ||
                                             (activeSection === 'conclusion' && i + 1 === 38);
                        
                        return (
                          <div 
                            key={i} 
                            className={`min-h-[26px] transition-colors duration-500 ${isHighlighted ? 'bg-accent/5 ring-1 ring-accent/10 rounded-sm' : ''}`}
                          >
                            {line.split(/(\\[a-z]+|{.*?}|\[.*?\])/g).map((part, j) => {
                              if (part.startsWith('\\')) return <span key={j} className="text-accent font-bold">{part}</span>;
                              if (part.startsWith('{') || part.startsWith('[')) return <span key={j} className="text-emerald-600">{part}</span>;
                              return <span key={j}>{part}</span>;
                            })}
                            {line === '' && '\u200B'}
                          </div>
                        );
                      })}
                    </div>

                    {/* Actual Editable Textarea - Overlays the highlight layer */}
                    <textarea
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      spellCheck={false}
                      className="row-start-1 col-start-1 w-full h-full p-6 bg-transparent text-transparent caret-ink resize-none outline-none selection:bg-accent/20 whitespace-pre-wrap break-words font-mono text-sm leading-[26px] z-20 overflow-hidden"
                    />

                    {/* Collaboration Cursor */}
                    <motion.div 
                      animate={{ 
                        top: cursorPos.top,
                        left: cursorPos.left
                      }}
                      transition={{ type: "spring", stiffness: 100, damping: 20 }}
                      className="absolute w-0.5 h-5 bg-emerald-500 pointer-events-none z-30"
                    >
                      <div className="absolute -top-5 left-0 bg-emerald-500 text-white text-[9px] px-1.5 py-0.5 rounded-sm whitespace-nowrap font-sans font-bold shadow-sm">
                        User_42
                      </div>
                      <motion.div 
                        animate={{ opacity: [1, 0] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="absolute inset-0 bg-emerald-500/30 blur-[2px]"
                      />
                    </motion.div>
                  </div>
                </div>
              </section>

              {/* Right Preview Panel */}
              <section className="w-[480px] flex flex-col border-l border-stone-200 bg-preview-bg shrink-0">
                <div className="h-12 flex items-center px-4 bg-sidebar border-b border-stone-200 shrink-0 gap-4">
                  <button 
                    onClick={() => setRightTab('pdf')}
                    className={`text-[10px] font-bold uppercase tracking-widest transition-colors relative py-4 ${rightTab === 'pdf' ? 'text-accent' : 'text-stone-400 hover:text-accent'}`}
                  >
                    PDF 预览
                    {rightTab === 'pdf' && <motion.div layoutId="right-tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
                  </button>
                  <button 
                    onClick={() => setRightTab('tone')}
                    className={`text-[10px] font-bold uppercase tracking-widest transition-colors relative py-4 ${rightTab === 'tone' ? 'text-accent' : 'text-stone-400 hover:text-accent'}`}
                  >
                    论文基调
                    {rightTab === 'tone' && <motion.div layoutId="right-tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
                  </button>
                  <button 
                    onClick={() => setRightTab('ref')}
                    className={`text-[10px] font-bold uppercase tracking-widest transition-colors relative py-4 ${rightTab === 'ref' ? 'text-accent' : 'text-stone-400 hover:text-accent'}`}
                  >
                    参考详情
                    {rightTab === 'ref' && <motion.div layoutId="right-tab-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
                  </button>
                </div>

                <div className="flex-1 overflow-hidden relative">
                  <AnimatePresence mode="wait">
                    {rightTab === 'pdf' && (
                      <motion.div 
                        key="pdf"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute inset-0 flex flex-col"
                      >
                        <div className="h-10 flex items-center justify-between px-4 bg-stone-50 border-b border-stone-100 shrink-0">
                          <button onClick={toggleFitWidth} className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent text-white">适应宽度</button>
                          <div className="flex items-center gap-1">
                            <ZoomIn className="w-3.5 h-3.5 text-stone-400" />
                            <ZoomOut className="w-3.5 h-3.5 text-stone-400" />
                          </div>
                        </div>
                        <div ref={pdfRef} className="flex-1 p-4 overflow-auto custom-scrollbar scroll-smooth">
                          <div className="min-h-full flex justify-center items-start py-8">
                            <div className="bg-white shadow-xl aspect-[1/1.414] w-full p-12 text-ink flex flex-col border border-stone-100">
                              <div className="text-center mb-10">
                                <h2 className="text-xl font-bold mb-2 leading-tight text-stone-900">Quantum Cryptography in Distributed Networks</h2>
                                <p className="text-sm italic text-stone-600">Research Team Alpha</p>
                              </div>
                              <div className="space-y-6">
                                <section id="pdf-intro" className={`transition-all duration-500 rounded-lg p-2 -m-2 ${activeSection === 'intro' ? 'bg-accent/5 ring-1 ring-accent/10' : ''}`}>
                                  <h3 className="text-base font-bold mb-3 text-stone-900">1 Introduction</h3>
                                  <p className="text-xs leading-relaxed text-justify text-stone-700">The security of modern communication networks relies heavily on the distribution of secret keys...</p>
                                </section>
                                <section id="pdf-method" className={`transition-all duration-500 rounded-lg p-2 -m-2 ${activeSection === 'method' ? 'bg-accent/5 ring-1 ring-accent/10' : ''}`}>
                                  <h3 className="text-base font-bold mb-3 text-stone-900">2 Methodology</h3>
                                  <p className="text-xs leading-relaxed text-justify text-stone-700">We analyze a BB84 protocol implementation over a star network topology...</p>
                                </section>
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {rightTab === 'tone' && (
                      <motion.div 
                        key="tone"
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        className="absolute inset-0 p-8 overflow-auto custom-scrollbar"
                      >
                        <div className="mb-6 flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-accent">Context 挂载中</span>
                          <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                        </div>
                        <h2 className="text-xl font-bold text-ink mb-4">{initialTone.name}</h2>
                        <div className="mb-6 h-1 w-12 bg-accent rounded-full" />
                        <div className="prose prose-sm prose-stone dark:prose-invert">
                          <p className="text-sm leading-relaxed text-ink-muted whitespace-pre-wrap">
                            {initialTone.content}
                            {"\n\n"}
                            1. 研究背景：量子通信在分布式网络中的安全性...
                            {"\n"}
                            2. 核心创新：提出了一种基于 BB84 协议的星型拓扑优化方案...
                            {"\n"}
                            3. 预期成果：在 50km 光纤环境下实现 1.2kbps 的稳定成钥率...
                          </p>
                        </div>
                        <div className="mt-8 p-4 rounded-xl bg-accent/5 border border-accent/10">
                          <p className="text-[10px] font-bold text-accent uppercase mb-2">AI 写作约束</p>
                          <ul className="text-xs text-ink-muted space-y-2">
                            <li>• 保持学术严谨的语气</li>
                            <li>• 优先引用开题报告中的技术路线</li>
                            <li>• 创新点描述需与开题报告保持一致</li>
                          </ul>
                        </div>
                      </motion.div>
                    )}

                    {rightTab === 'ref' && (
                      <motion.div 
                        key="ref"
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        className="absolute inset-0 p-8 overflow-auto custom-scrollbar"
                      >
                        <div className="mb-6 flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-accent">参考详情</span>
                        </div>
                        <h2 className="text-xl font-bold leading-tight text-ink mb-4">{selectedPaper.title}</h2>
                        <div className="mb-6 h-1 w-12 bg-accent rounded-full" />
                        <p className="text-sm font-medium text-ink-muted mb-6">{selectedPaper.authors}</p>
                        <div className="mb-8">
                          <p className="text-sm leading-relaxed text-ink-muted">
                            {selectedPaper.abstract}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <button className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-xs font-bold text-white hover:bg-accent-hover transition-all">
                            <Download className="w-4 h-4" /> 下载 PDF
                          </button>
                          <button className="flex items-center justify-center gap-2 rounded-xl border-2 border-accent/20 bg-accent/5 px-4 py-3 text-xs font-bold text-accent">
                            <Plus className="w-4 h-4" /> 收藏
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Preview Footer */}
                <div className="h-10 bg-sidebar border-t border-stone-200 flex items-center justify-between px-4 text-[10px] text-stone-500 shrink-0">
                  <span>{rightTab === 'pdf' ? '第 1 页，共 8 页' : 'Context 面板'}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    <span>实时同步中</span>
                  </div>
                </div>
              </section>
            </motion.div>
          ) : (
            <motion.div 
              key="discovery"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex flex-1 overflow-hidden"
            >
              {/* Discovery Sidebar */}
              <aside className="w-64 flex flex-col border-r border-stone-200 bg-sidebar shrink-0">
                <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar">
                  <section>
                    <h3 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-stone-400">筛选</h3>
                    <div className="space-y-1">
                      <button className="flex w-full items-center gap-3 rounded-lg bg-accent/10 px-3 py-2 text-sm font-bold text-accent">
                        <FlaskConical className="w-4 h-4" />
                        机器学习
                      </button>
                      <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-stone-100 transition-colors">
                        <Brain className="w-4 h-4" />
                        神经网络
                      </button>
                      <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-stone-100 transition-colors">
                        <Terminal className="w-4 h-4" />
                        计算机视觉
                      </button>
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-stone-400">状态</h3>
                    <div className="space-y-2 px-1">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <div className="w-4 h-4 rounded border border-stone-300 bg-white flex items-center justify-center group-hover:border-accent transition-colors">
                          <Check className="w-3 h-3 text-accent" />
                        </div>
                        <span className="text-sm text-ink-muted group-hover:text-ink">已读</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <div className="w-4 h-4 rounded border border-stone-300 bg-white group-hover:border-accent transition-colors" />
                        <span className="text-sm text-ink-muted group-hover:text-ink">未读</span>
                      </label>
                    </div>
                  </section>

                  <section>
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-[11px] font-bold uppercase tracking-widest text-stone-400">我的收藏</h3>
                      <button className="text-accent hover:bg-accent/10 p-1 rounded transition-colors">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-1">
                      <a className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-stone-100 transition-colors" href="#">
                        <Folder className="w-4 h-4 text-amber-500" />
                        论文研究
                      </a>
                      <a className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-stone-100 transition-colors" href="#">
                        <Folder className="w-4 h-4 text-emerald-500" />
                        自然语言处理论文
                      </a>
                      <a className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-stone-100 transition-colors" href="#">
                        <Folder className="w-4 h-4 text-blue-500" />
                        夏末阅读
                      </a>
                    </div>
                  </section>
                </div>
              </aside>

              {/* Discovery Main */}
              <main className="flex-1 overflow-y-auto bg-stone-50 p-8 custom-scrollbar">
                <div className="mb-8">
                  <nav className="mb-4 flex items-center gap-2 text-xs font-medium text-stone-400">
                    <a className="hover:text-accent transition-colors" href="#">搜索结果</a>
                    <ChevronRight className="w-3 h-3" />
                    <span className="text-ink font-bold">"神经网络"</span>
                  </nav>
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                      <h2 className="text-3xl font-bold text-ink tracking-tight">神经网络</h2>
                      <p className="mt-1 text-sm text-ink-muted">找到 1,240 条结果 • 去年新增 120 篇</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold border border-stone-200 shadow-sm hover:border-accent transition-all">
                        排序：相关性 
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-stone-200 shadow-sm hover:border-accent transition-all text-ink-muted">
                        <List className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="max-w-4xl space-y-4">
                  {discoveryPapers.map((paper) => (
                    <div 
                      key={paper.id} 
                      onClick={() => setSelectedPaper(paper)}
                      className={`group relative rounded-2xl border-2 bg-white p-6 shadow-sm hover:shadow-md transition-all cursor-pointer ${selectedPaper.id === paper.id ? 'border-accent ring-4 ring-accent/5' : 'border-stone-100 hover:border-accent/50'}`}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex flex-wrap gap-2">
                          {paper.tags.map(tag => (
                            <span key={tag} className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tag === '已读' ? 'bg-emerald-100 text-emerald-600' : tag === '高引用' ? 'bg-accent/10 text-accent' : 'bg-stone-100 text-stone-500'}`}>
                              {tag}
                            </span>
                          ))}
                        </div>
                        <button className="text-stone-300 hover:text-accent transition-colors">
                          <Bookmark className="w-5 h-5" />
                        </button>
                      </div>
                      <h3 className="text-lg font-bold text-ink group-hover:text-accent transition-colors mb-2 leading-snug">
                        {paper.title}
                      </h3>
                      <p className="text-sm font-medium text-ink-muted mb-4">{paper.authors}</p>
                      <div className="flex items-center gap-6 text-[11px] font-bold text-stone-400 uppercase tracking-wider">
                        <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {paper.date}</span>
                        <span className="flex items-center gap-1.5"><Quote className="w-3.5 h-3.5" /> {paper.citations}次引用</span>
                        {paper.pages && <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> {paper.pages}页</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </main>

              {/* Discovery Right Sidebar (Unified) */}
              <aside className="w-[400px] border-l border-stone-200 bg-white flex flex-col shrink-0">
                <div className="p-8 overflow-y-auto custom-scrollbar">
                  <div className="mb-6 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-accent">摘要预览</span>
                  </div>
                  <h2 className="text-xl font-bold leading-tight text-ink mb-4">
                    {selectedPaper.title}
                  </h2>
                  <div className="mb-6 h-1 w-12 bg-accent rounded-full" />
                  <div className="mb-8">
                    <p className="text-sm leading-relaxed text-ink-muted">
                      {selectedPaper.abstract}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <button className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-xs font-bold text-white hover:bg-accent-hover transition-all">
                      <Download className="w-4 h-4" /> 下载 PDF
                    </button>
                    <button className="flex items-center justify-center gap-2 rounded-xl border-2 border-accent/20 bg-accent/5 px-4 py-3 text-xs font-bold text-accent">
                      <Plus className="w-4 h-4" /> 收藏
                    </button>
                  </div>
                </div>
              </aside>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <style>{`
        /* Completely hide scrollbars but keep functionality */
        .custom-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .custom-scrollbar {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }
        
        /* Optional: Show a very subtle scrollbar only on hover if you really need it */
        /* But for now, let's keep it totally clean as requested */

        /* Ensure textarea and overlay match perfectly */
        textarea {
          line-height: 26px !important;
        }
      `}</style>
    </div>
  );
}
