/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Upload, 
  Image as ImageIcon, 
  Trash2, 
  BarChart3, 
  PieChart as PieChartIcon, 
  Quote, 
  Hash, 
  FileText, 
  Loader2, 
  Plus,
  Presentation,
  LayoutDashboard,
  RefreshCw,
  Download,
  File as FileIcon,
  FileCode
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  Legend
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import heic2any from 'heic2any';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  extractTextFromFile, 
  analyzeResponses, 
  WorkshopResponse, 
  AnalysisResult 
} from './services/geminiService';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const SENTIMENT_COLORS = {
  'Positive': '#10b981',
  'Neutral': '#3b82f6',
  'Negative': '#ef4444'
};

const KaMaramaLogo = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="1.5" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    {/* Diamond Frame */}
    <path d="M12 3L22 12L12 21L2 12L12 3Z" />
    
    {/* Sun (Semi-circle at the bottom) */}
    <path d="M8 17 A 4 4 0 0 1 16 17" />
    
    {/* Rays */}
    <line x1="12" y1="17" x2="12" y2="8" />
    <line x1="12" y1="17" x2="16" y2="10" />
    <line x1="12" y1="17" x2="8" y2="10" />
    <line x1="12" y1="17" x2="19" y2="12" />
    <line x1="12" y1="17" x2="5" y2="12" />
    <line x1="12" y1="17" x2="15" y2="14" />
    <line x1="12" y1="17" x2="9" y2="14" />
  </svg>
);

export default function App() {
  const [responses, setResponses] = useState<WorkshopResponse[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [lastAnalyzedCount, setLastAnalyzedCount] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [viewMode, setViewMode] = useState<'dashboard' | 'presentation'>('dashboard');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [questions, setQuestions] = useState<string[]>([
    "What's going well?",
    "What needs improving?",
    "How important is this to your class? (Scale 1-5)"
  ]);
  const [isApiConfigured, setIsApiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    const checkApiStatus = async () => {
      try {
        const response = await fetch('/api/status');
        const data = await response.json();
        setIsApiConfigured(data.isConfigured);
      } catch (error) {
        console.error('Failed to check API status:', error);
        setIsApiConfigured(false);
      }
    };
    checkApiStatus();
  }, []);

  const readyResponsesCount = responses.filter(r => r.status === 'ready').length;
  const needsAnalysis = readyResponsesCount > 0 && readyResponsesCount !== lastAnalyzedCount;

  // Handle file uploads
  const onFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    const newResponses: WorkshopResponse[] = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      imageUrl: URL.createObjectURL(file),
      extractedText: '',
      status: 'processing',
      mimeType: file.type
    }));

    setResponses(prev => [...prev, ...newResponses]);

    // Process each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const responseId = newResponses[i].id;

      try {
        let processedFile: File = file;
        let mimeType = file.type;
        
        // Handle HEIC
        if (file.type === 'image/heic' || file.name.toLowerCase().endsWith('.heic')) {
          const result = await heic2any({ blob: file, toType: 'image/jpeg' });
          const blob = (Array.isArray(result) ? result[0] : result) as Blob;
          processedFile = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
          mimeType = 'image/jpeg';
        }

        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = reader.result as string;
          try {
            const text = await extractTextFromFile(base64, mimeType);
            setResponses(prev => prev.map(r => 
              r.id === responseId ? { ...r, extractedText: text, status: 'ready', mimeType } : r
            ));
          } catch (error) {
            console.error('Extraction Error:', error);
            setResponses(prev => prev.map(r => 
              r.id === responseId ? { ...r, status: 'error' } : r
            ));
          }
        };
        reader.readAsDataURL(processedFile);
      } catch (error) {
        console.error('File processing error:', error);
        setResponses(prev => prev.map(r => 
          r.id === responseId ? { ...r, status: 'error' } : r
        ));
      }
    }
  };

  const removeResponse = (id: string) => {
    setResponses(prev => prev.filter(r => r.id !== id));
  };

  const updateText = (id: string, text: string) => {
    setResponses(prev => prev.map(r => r.id === id ? { ...r, extractedText: text } : r));
  };

  const updateQuestion = (index: number, text: string) => {
    const newQuestions = [...questions];
    newQuestions[index] = text;
    setQuestions(newQuestions);
  };

  // Trigger AI Analysis
  const runAnalysis = useCallback(async () => {
    const readyTexts = responses
      .filter(r => r.status === 'ready' && r.extractedText.trim())
      .map(r => r.extractedText);

    if (readyTexts.length === 0) return;

    setIsAnalyzing(true);
    try {
      const result = await analyzeResponses(readyTexts, questions);
      setAnalysis(result);
      setLastAnalyzedCount(readyTexts.length);
    } catch (error) {
      console.error('Analysis Error:', error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [responses, questions]);

  const clearAll = () => {
    if (window.confirm('Are you sure you want to clear all responses and analysis?')) {
      setResponses([]);
      setAnalysis(null);
      setLastAnalyzedCount(0);
    }
  };

  const loadDemoData = () => {
    const demoResponses: WorkshopResponse[] = [
      {
        id: 'demo1',
        imageUrl: 'https://picsum.photos/seed/note1/400/600',
        extractedText: "1. The group discussions are going really well, everyone is participating. 2. We need more time for the practical exercises. 3. 5",
        status: 'ready'
      },
      {
        id: 'demo2',
        imageUrl: 'https://picsum.photos/seed/note2/400/600',
        extractedText: "1. I like the hands-on activities. 2. Some of the instructions are a bit confusing. 3. 4",
        status: 'ready'
      },
      {
        id: 'demo3',
        imageUrl: 'https://picsum.photos/seed/note3/400/600',
        extractedText: "1. The teacher explains things clearly. 2. The room is a bit noisy sometimes. 3. 5",
        status: 'ready'
      }
    ];
    setResponses(demoResponses);
  };

  const exportCSV = () => {
    const headers = ['ID', 'Extracted Text'];
    const rows = responses.map(r => [r.id, `"${r.extractedText.replace(/"/g, '""')}"`]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "Ka-Marama-Responses.csv";
    link.click();
  };

  const getBase64FromUrl = async (url: string): Promise<string> => {
    const data = await fetch(url);
    const blob = await data.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        const base64data = reader.result as string;
        resolve(base64data);
      };
      reader.onerror = reject;
    });
  };

  const exportPDF = async () => {
    if (!analysis) {
      console.warn('No analysis available for export');
      return;
    }
    setIsExporting(true);
    
    try {
      console.log('Starting PDF export (Hybrid Mode)...');
      
      // Create PDF
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4',
        compress: true
      });
      
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - (2 * margin);

      // Pre-render the "Ka Mārama" title as an image to avoid Unicode issues with standard PDF fonts
      const renderTitleImage = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 120;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#ffffff';
        // Using a stack of fonts to ensure the macron renders correctly
        ctx.font = 'bold 72px "Inter", "Segoe UI", "Roboto", "Arial", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText('Ka Mārama', 0, 60);
        return canvas.toDataURL('image/png');
      };
      
      const titleImg = renderTitleImage();

      // Helper for Header
      const addHeader = (title: string) => {
        pdf.setFillColor('#10b981'); // Emerald 500
        pdf.rect(0, 0, pageWidth, 35, 'F');
        
        if (titleImg) {
          // Add the pre-rendered Unicode-safe title
          pdf.addImage(titleImg, 'PNG', margin, 8, 48, 7.2);
        } else {
          // Fallback to plain text if canvas fails
          pdf.setTextColor('#ffffff');
          pdf.setFontSize(22);
          pdf.setFont('helvetica', 'bold');
          pdf.text('Ka Marama', margin, 18);
        }

        pdf.setTextColor('#ffffff');
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.text(title, margin, 28);
        pdf.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin - 40, 28);
        
        // Footer line
        pdf.setDrawColor('#e2e8f0'); // Slate 200
        pdf.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15);
        pdf.setFontSize(8);
        pdf.setTextColor('#94a3b8'); // Slate 400
        // Use plain text for footer to avoid encoding issues in small text
        pdf.text('Ka Marama Workshop Analysis Report', margin, pageHeight - 10);
        pdf.text(`Page ${pdf.getNumberOfPages()}`, pageWidth - margin - 15, pageHeight - 10);
      };

      // PAGE 1: Executive Summary
      addHeader('Executive Summary & Question Analysis');
      
      let y = 50;
      
      // Summary
      pdf.setTextColor('#10b981'); // Emerald 500
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('EXECUTIVE SUMMARY', margin, y);
      y += 8;
      
      pdf.setTextColor('#334155'); // Slate 700
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      const summaryLines = pdf.splitTextToSize(analysis.summary, contentWidth);
      pdf.text(summaryLines, margin, y);
      y += (summaryLines.length * 5) + 10;

      // Question Summaries
      analysis.questionSummaries.forEach((qs, i) => {
        if (y > pageHeight - 40) {
          pdf.addPage();
          addHeader('Question Analysis (Continued)');
          y = 50;
        }

        pdf.setTextColor('#10b981');
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`QUESTION ${i + 1}: ${qs.question}`, margin, y);
        y += 6;

        pdf.setTextColor('#475569'); // Slate 600
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        const qsLines = pdf.splitTextToSize(qs.summary, contentWidth);
        pdf.text(qsLines, margin, y);
        y += (qsLines.length * 4.5) + 8;
      });

      // Average Score
      pdf.setDrawColor('#f1f5f9');
      pdf.line(margin, y, pageWidth - margin, y);
      y += 10;
      pdf.setTextColor('#10b981');
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`AVERAGE IMPORTANCE SCORE: ${analysis.averageImportance.toFixed(1)} / 5.0`, margin, y);
      
      // PAGE 2: Charts & Insights
      pdf.addPage();
      addHeader('Visual Analysis & Themes');
      y = 50;

      // Capture Themes Chart
      const themesEl = document.getElementById('themes-chart');
      if (themesEl) {
        try {
          // Small delay to ensure any animations are settled
          await new Promise(resolve => setTimeout(resolve, 500));
          const canvas = await html2canvas(themesEl, { 
            scale: 2, 
            backgroundColor: '#ffffff', 
            useCORS: true,
            logging: false,
            allowTaint: true,
            onclone: (clonedDoc) => {
              // Ensure the cloned element is visible for capture
              const el = clonedDoc.getElementById('themes-chart');
              if (el) el.style.visibility = 'visible';
            }
          });
          const imgData = canvas.toDataURL('image/png');
          pdf.setTextColor('#10b981');
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.text('COMMON THEMES', margin, y);
          y += 5;
          pdf.addImage(imgData, 'PNG', margin, y, contentWidth, 60, undefined, 'FAST');
          y += 70;
        } catch (e) {
          console.error('Error capturing themes chart:', e);
          // Fallback: List themes if chart fails
          pdf.setTextColor('#ef4444');
          pdf.setFontSize(8);
          pdf.text('Chart capture failed. See data below.', margin, y);
          y += 5;
        }
      }

      // Capture Sentiment Chart
      const sentimentEl = document.getElementById('sentiment-chart');
      if (sentimentEl) {
        try {
          const canvas = await html2canvas(sentimentEl, { 
            scale: 2, 
            backgroundColor: '#ffffff', 
            useCORS: true,
            logging: false,
            allowTaint: true,
            onclone: (clonedDoc) => {
              const el = clonedDoc.getElementById('sentiment-chart');
              if (el) el.style.visibility = 'visible';
            }
          });
          const imgData = canvas.toDataURL('image/png');
          pdf.setTextColor('#10b981');
          pdf.setFontSize(12);
          pdf.setFont('helvetica', 'bold');
          pdf.text('SENTIMENT DISTRIBUTION', margin, y);
          y += 5;
          pdf.addImage(imgData, 'PNG', margin, y, contentWidth / 1.5, 60, undefined, 'FAST');
          y += 70;
        } catch (e) {
          console.error('Error capturing sentiment chart:', e);
        }
      }

      // Keywords Section
      if (y > pageHeight - 60) {
        pdf.addPage();
        addHeader('Keywords & Quotes');
        y = 50;
      }
      pdf.setTextColor('#10b981');
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('TOP KEYWORDS', margin, y);
      y += 8;
      
      pdf.setTextColor('#334155');
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      const keywordsStr = analysis.keywords.map(kw => `${kw.name} (${kw.count})`).join(', ');
      const kwLines = pdf.splitTextToSize(keywordsStr, contentWidth);
      pdf.text(kwLines, margin, y);
      y += (kwLines.length * 5) + 12;

      // Quotes Section
      if (y > pageHeight - 60) {
        pdf.addPage();
        addHeader('Keywords & Quotes (Continued)');
        y = 50;
      }
      pdf.setTextColor('#10b981');
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.text('KEY QUOTES', margin, y);
      y += 8;

      analysis.quotes.forEach((quote) => {
        if (y > pageHeight - 30) {
          pdf.addPage();
          addHeader('Key Quotes (Continued)');
          y = 50;
        }
        pdf.setTextColor('#475569');
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'italic');
        const quoteLines = pdf.splitTextToSize(`"${quote}"`, contentWidth - 10);
        pdf.text(quoteLines, margin + 5, y);
        y += (quoteLines.length * 4.5) + 6;
      });

      // PAGE 3+: Appendix
      if (responses.length > 0) {
        pdf.addPage();
        addHeader('Appendix: Participant Responses');
        y = 50;

        for (const res of responses) {
          if (y > pageHeight - 60) {
            pdf.addPage();
            addHeader('Appendix: Participant Responses (Continued)');
            y = 50;
          }

          try {
            // Image
            if (res.imageUrl) {
              let base64Img: string;
              if (res.imageUrl.startsWith('data:')) {
                base64Img = res.imageUrl;
              } else {
                base64Img = await getBase64FromUrl(res.imageUrl);
              }
              const format = res.mimeType?.includes('png') ? 'PNG' : 'JPEG';
              pdf.addImage(base64Img, format, margin, y, 40, 40, undefined, 'FAST');
            }

            // Text
            pdf.setTextColor('#10b981');
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'bold');
            pdf.text(`Response ID: ${res.id}`, margin + 45, y + 5);
            
            pdf.setTextColor('#475569');
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'normal');
            const resLines = pdf.splitTextToSize(res.extractedText || "No text extracted.", pageWidth - margin - 60);
            pdf.text(resLines, margin + 45, y + 12);
            
            y += 50;
          } catch (e) {
            console.error(`Error processing response ${res.id} for PDF:`, e);
            y += 10;
          }
        }
      }

      pdf.save(`Ka-Marama-Report-${new Date().toISOString().split('T')[0]}.pdf`);
      console.log('PDF export complete.');
    } catch (error) {
      console.error('PDF Export Error:', error);
      alert(`Error generating PDF: ${error instanceof Error ? error.message : 'Unknown error'}. Try exporting as CSV if this persists.`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-600 p-2 rounded-lg">
            <KaMaramaLogo className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Ka Mārama</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">It Will be Clear</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setViewMode(viewMode === 'dashboard' ? 'presentation' : 'dashboard')}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 hover:bg-slate-50 transition-colors text-sm font-medium"
          >
            {viewMode === 'dashboard' ? <Presentation size={18} /> : <LayoutDashboard size={18} />}
            {viewMode === 'dashboard' ? 'Presentation Mode' : 'Editor Mode'}
          </button>
          
          <button 
            onClick={loadDemoData}
            className="text-sm font-medium text-emerald-600 hover:text-emerald-700 underline underline-offset-4"
          >
            Load Demo Data
          </button>

          <button 
            onClick={clearAll}
            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors ml-2"
            title="Clear All Session Data"
          >
            <Trash2 size={20} />
          </button>

          <div className="h-10 w-px bg-slate-200 mx-2 hidden sm:block"></div>
          
          <img 
            src="https://scontent.fwlg4-1.fna.fbcdn.net/v/t39.30808-6/292956024_527181305829693_1238478588399588818_n.png?_nc_cat=104&ccb=1-7&_nc_sid=1d70fc&_nc_ohc=0gB5ZDy_to0Q7kNvwEKt1cV&_nc_oc=Adknahfx_F7CSnK3Kj-4mUR9XjOKH1oKBb6hi_QQyTMtIn_5kJxtdM2jgpQf3YNQZ85eNGJ7ow8tJyfuClIsYQFz&_nc_zt=23&_nc_ht=scontent.fwlg4-1.fna&_nc_gid=pfiWnVYbzivSBAVQG2aFRA&_nc_ss=8&oh=00_Afxrz0i_bTBE02pfj5Eox05tY7apsJVucaKURxs-jzRRcg&oe=69BEDE3F" 
            alt="Logo" 
            className="h-10 w-auto object-contain"
            referrerPolicy="no-referrer"
          />
        </div>
      </header>

      {isApiConfigured === false && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-center gap-3 text-amber-800 text-sm font-medium">
          <div className="bg-amber-100 p-1.5 rounded-full">
            <Loader2 size={16} className="text-amber-600" />
          </div>
          <p>
            Gemini API Key is missing on the server. Please add <span className="font-bold">GEMINI_API_KEY</span> to the 
            <span className="bg-amber-100 px-1.5 py-0.5 rounded mx-1">Secrets</span> panel in AI Studio to enable AI features.
          </p>
        </div>
      )}

      <main className="p-6">
        {viewMode === 'dashboard' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Upload & List */}
            <div className="lg:col-span-4 space-y-6">
              <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <FileText size={20} className="text-emerald-600" />
                  Focus Questions
                </h2>
                <div className="space-y-3">
                  {questions.map((q, i) => (
                    <div key={i} className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Question {i + 1}</label>
                      <input 
                        type="text" 
                        value={q}
                        onChange={(e) => updateQuestion(i, e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                        placeholder={`Question ${i + 1}`}
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Upload size={20} className="text-emerald-600" />
                  Upload Responses
                </h2>
                <label className="border-2 border-dashed border-slate-200 rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all group">
                  <input type="file" multiple accept="image/*,.pdf,.doc,.docx,image/heic,image/heif" onChange={onFileUpload} className="hidden" />
                  <div className="bg-emerald-100 p-3 rounded-full text-emerald-600 group-hover:scale-110 transition-transform">
                    <Plus size={24} />
                  </div>
                  <div className="text-center">
                    <p className="font-medium">Click to upload or drag & drop</p>
                    <p className="text-xs text-slate-400 mt-1">JPG, PNG, HEIC, PDF, DOCX supported</p>
                  </div>
                </label>
              </section>

              <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 max-h-[calc(100vh-450px)] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <ImageIcon size={20} className="text-emerald-600" />
                    Captured ({responses.length})
                  </h2>
                </div>
                
                <div className="space-y-4">
                  <AnimatePresence initial={false}>
                    {responses.map((res) => (
                      <motion.div 
                        key={res.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="p-3 border border-slate-100 rounded-xl bg-slate-50/50 group"
                      >
                        <div className="flex gap-3">
                          <div 
                            className="relative w-20 h-20 flex-shrink-0 cursor-pointer group/thumb"
                            onClick={() => (res.mimeType?.includes('image') || res.imageUrl.startsWith('data:image')) && setSelectedImage(res.imageUrl)}
                          >
                            {res.mimeType?.includes('image') || res.imageUrl.startsWith('data:image') ? (
                              <div className="relative w-full h-full">
                                <img 
                                  src={res.imageUrl} 
                                  alt="Response" 
                                  className="w-full h-full object-cover rounded-lg shadow-sm group-hover/thumb:opacity-75 transition-opacity"
                                  referrerPolicy="no-referrer"
                                />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                                  <Plus size={20} className="text-white drop-shadow-md" />
                                </div>
                              </div>
                            ) : (
                              <div className="w-full h-full bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
                                {res.mimeType?.includes('pdf') ? <FileCode size={32} /> : <FileIcon size={32} />}
                              </div>
                            )}
                            {res.status === 'processing' && (
                              <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                                <Loader2 className="text-white animate-spin" size={20} />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">ID: {res.id}</span>
                              <button 
                                onClick={() => removeResponse(res.id)}
                                className="text-slate-300 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <textarea 
                              value={res.extractedText}
                              onChange={(e) => updateText(res.id, e.target.value)}
                              placeholder={res.status === 'processing' ? 'Extracting text...' : 'Extracted text will appear here...'}
                              className="w-full mt-1 text-sm bg-transparent border-none focus:ring-0 p-0 resize-none h-12 text-slate-600"
                            />
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {responses.length === 0 && (
                    <div className="text-center py-12 text-slate-400">
                      <ImageIcon size={48} className="mx-auto mb-3 opacity-20" />
                      <p className="text-sm">No responses uploaded yet</p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Right Column: Dashboard */}
            <div className="lg:col-span-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-bold tracking-tight">Live Insights</h2>
                  {analysis && (
                    <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      {lastAnalyzedCount} of {readyResponsesCount} Responses Analyzed
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {responses.length > 0 && analysis && (
                    <div className="flex items-center gap-2 mr-2">
                      <button 
                        onClick={exportCSV} 
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-xs font-bold text-slate-600 uppercase tracking-wider"
                        title="Export CSV"
                      >
                        <Download size={14} />
                        CSV
                      </button>
                      <button 
                        onClick={exportPDF} 
                        disabled={isExporting}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors text-xs font-bold uppercase tracking-wider disabled:opacity-50 shadow-sm"
                        title="Export PDF Report"
                      >
                        {isExporting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                        PDF Report
                      </button>
                    </div>
                  )}
                  
                  <button 
                    onClick={runAnalysis}
                    disabled={isAnalyzing || responses.length === 0}
                    className={`px-6 py-2 rounded-full text-sm font-bold transition-all active:scale-95 flex items-center gap-2 shadow-lg ${
                      needsAnalysis 
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200 ring-4 ring-emerald-100' 
                        : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                    }`}
                  >
                    {isAnalyzing ? <RefreshCw size={16} className="animate-spin" /> : <BarChart3 size={16} />}
                    {needsAnalysis ? 'Analyze New Responses' : 'Refresh Analysis'}
                  </button>
                </div>
              </div>

              {analysis ? (
                <div id="analysis-content" className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Summary Card */}
                  <div className="md:col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <FileText size={16} />
                      Executive Summary
                    </h3>
                    <p className="text-slate-700 leading-relaxed text-lg mb-6">
                      {analysis.summary}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 pt-6">
                      {analysis.questionSummaries.map((qs, i) => (
                        <div key={i} className="space-y-2">
                          <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Q{i+1}: {qs.question}</h4>
                          <p className="text-sm text-slate-600 leading-relaxed">{qs.summary}</p>
                          {i === 2 && (
                            <div className="pt-2">
                              <div className="text-[10px] font-bold text-slate-400 uppercase">Average Score</div>
                              <div className="text-2xl font-black text-emerald-600">{analysis.averageImportance.toFixed(1)}<span className="text-sm text-slate-400 font-normal">/5.0</span></div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Themes Chart */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                      <BarChart3 size={16} />
                      Common Themes
                    </h3>
                    <div id="themes-chart" className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analysis.themes} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                          <XAxis type="number" hide />
                          <YAxis 
                            dataKey="name" 
                            type="category" 
                            width={120} 
                            axisLine={false} 
                            tickLine={false}
                            tick={{ fontSize: 12, fontWeight: 500 }}
                          />
                          <Tooltip 
                            cursor={{ fill: '#f8fafc' }}
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          />
                          <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Sentiment Chart */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                      <PieChartIcon size={16} />
                      Sentiment Distribution
                    </h3>
                    <div id="sentiment-chart" className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analysis.sentiment}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {analysis.sentiment.map((entry, index) => (
                              <Cell 
                                key={`cell-${index}`} 
                                fill={SENTIMENT_COLORS[entry.name as keyof typeof SENTIMENT_COLORS] || COLORS[index % COLORS.length]} 
                              />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          />
                          <Legend verticalAlign="bottom" height={36}/>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Keywords */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <Hash size={16} />
                      Top Keywords
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {analysis.keywords.map((kw, i) => (
                        <span 
                          key={i} 
                          className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm font-medium flex items-center gap-2"
                        >
                          {kw.name}
                          <span className="bg-white px-1.5 rounded text-[10px] text-slate-400">{kw.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Quotes */}
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <Quote size={16} />
                      Key Quotes
                    </h3>
                    <div className="space-y-4">
                      {analysis.quotes.map((quote, i) => (
                        <div key={i} className="relative pl-6 italic text-slate-600 text-sm border-l-2 border-emerald-200">
                          <Quote className="absolute -left-1 -top-1 text-emerald-100" size={12} />
                          "{quote}"
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-20 shadow-sm border border-slate-100 text-center">
                  <BarChart3 size={64} className="mx-auto mb-4 text-slate-200" />
                  <h3 className="text-xl font-semibold text-slate-400">Analysis will appear here</h3>
                  <p className="text-slate-400 mt-2">Upload responses to see live insights</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Presentation Mode */
          <div className="max-w-6xl mx-auto space-y-8 py-10">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-4"
            >
              <h2 className="text-5xl font-black tracking-tight text-slate-900">Workshop Insights</h2>
              <p className="text-xl text-slate-500 max-w-2xl mx-auto">
                Real-time analysis of {responses.length} participant responses
              </p>
            </motion.div>

            {analysis ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Big Stat */}
                <div className="bg-emerald-600 rounded-3xl p-8 text-white flex flex-col items-center justify-center shadow-2xl shadow-emerald-200">
                  <span className="text-7xl font-black">{responses.length}</span>
                  <span className="text-lg font-bold uppercase tracking-widest opacity-80">Total Responses</span>
                </div>

                {/* Sentiment Summary */}
                <div className="bg-white rounded-3xl p-8 shadow-xl border border-slate-100 flex flex-col items-center justify-center">
                  <div className="h-40 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={analysis.sentiment}
                          cx="50%"
                          cy="50%"
                          innerRadius={40}
                          outerRadius={60}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {analysis.sentiment.map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={SENTIMENT_COLORS[entry.name as keyof typeof SENTIMENT_COLORS] || COLORS[index % COLORS.length]} 
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <span className="text-lg font-bold uppercase tracking-widest text-slate-400">Sentiment</span>
                </div>

                {/* Top Theme */}
                <div className="bg-white rounded-3xl p-8 shadow-xl border border-slate-100 flex flex-col items-center justify-center text-center">
                  <span className="text-3xl font-black text-emerald-600 mb-2">
                    {analysis.themes[0]?.name || 'N/A'}
                  </span>
                  <span className="text-lg font-bold uppercase tracking-widest text-slate-400">Main Theme</span>
                </div>

                {/* Summary Big */}
                <div className="md:col-span-3 bg-white rounded-3xl p-10 shadow-xl border border-slate-100">
                  <p className="text-3xl font-medium text-slate-800 leading-tight mb-10">
                    {analysis.summary}
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-slate-100 pt-10">
                    {analysis.questionSummaries.map((qs, i) => (
                      <div key={i} className="space-y-4">
                        <h4 className="text-sm font-black text-emerald-600 uppercase tracking-widest">Question {i+1}</h4>
                        <p className="text-xl font-bold text-slate-900 leading-snug mb-2">{qs.question}</p>
                        <p className="text-lg text-slate-600 leading-relaxed">{qs.summary}</p>
                        {i === 2 && (
                          <div className="pt-4">
                            <div className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Class Importance Score</div>
                            <div className="text-7xl font-black text-emerald-600 tabular-nums">
                              {analysis.averageImportance.toFixed(1)}
                              <span className="text-2xl text-slate-300 font-light ml-2">/ 5.0</span>
                            </div>
                            <div className="w-full h-3 bg-slate-100 rounded-full mt-4 overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${(analysis.averageImportance / 5) * 100}%` }}
                                className="h-full bg-emerald-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quotes Grid */}
                <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {analysis.quotes.slice(0, 4).map((quote, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.1 }}
                      className="bg-slate-50 rounded-2xl p-6 relative"
                    >
                      <Quote className="text-emerald-200 mb-2" size={24} />
                      <p className="text-xl italic text-slate-700">"{quote}"</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-40">
                <Loader2 className="mx-auto text-emerald-600 animate-spin mb-4" size={48} />
                <p className="text-2xl font-bold text-slate-400">Waiting for analysis...</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Image Preview Modal */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedImage(null)}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-10 cursor-zoom-out"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-5xl w-full max-h-full flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                src={selectedImage} 
                alt="Full Preview" 
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                referrerPolicy="no-referrer"
              />
              <button 
                onClick={() => setSelectedImage(null)}
                className="absolute -top-12 right-0 text-white hover:text-emerald-400 transition-colors flex items-center gap-2 font-bold uppercase tracking-widest text-xs"
              >
                Close <Plus size={24} className="rotate-45" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
