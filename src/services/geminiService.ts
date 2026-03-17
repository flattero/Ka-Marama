import mammoth from "mammoth";

export interface WorkshopResponse {
  id: string;
  imageUrl: string;
  extractedText: string;
  status: 'processing' | 'ready' | 'error';
  mimeType?: string;
}

export interface AnalysisResult {
  themes: { name: string; count: number }[];
  sentiment: { name: string; value: number }[];
  keywords: { name: string; count: number }[];
  quotes: string[];
  summary: string;
  questionSummaries: { question: string; summary: string }[];
  averageImportance: number;
}

export async function extractTextFromFile(base64Data: string, mimeType: string): Promise<string> {
  // Handle Word Documents (.docx) separately via mammoth
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const arrayBuffer = Uint8Array.from(atob(base64Data.split(',')[1]), c => c.charCodeAt(0)).buffer;
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value || "";
    } catch (error) {
      console.error('Mammoth Extraction Error:', error);
      return "";
    }
  }

  // Handle Images and PDF via Backend
  try {
    const response = await fetch('/api/extract-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        base64Data: base64Data.split(',')[1], 
        mimeType 
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to extract text');
    }
    
    const data = await response.json();
    return data.text || "";
  } catch (error) {
    console.error('Extraction Error:', error);
    throw error;
  }
}

export async function analyzeResponses(responses: string[], questions: string[]): Promise<AnalysisResult> {
  try {
    const response = await fetch('/api/analyze-responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses, questions })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to analyze responses');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Analysis Error:', error);
    throw error;
  }
}
