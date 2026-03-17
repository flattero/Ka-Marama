import { GoogleGenAI, Type } from "@google/genai";
import mammoth from "mammoth";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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

  // Handle Images and PDF via Gemini
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: base64Data.split(',')[1],
              mimeType: mimeType
            }
          },
          { text: `Please extract the information from this workshop response. 
Look for:
1. Handwritten or typed text for the open-ended questions.
2. For the importance scale (1-5), identify the selected value. This might be a written number, a tick, a cross, or a shaded circle/box. 

Return the findings clearly, for example:
"1. [Text for Q1]
2. [Text for Q2]
3. [The detected number 1-5]"

If you see a scale with the 5th circle shaded, return "3. 5". 
Return only the extracted information, nothing else.` }
        ]
      }
    ]
  });

  return response.text || "";
}

export async function analyzeResponses(responses: string[], questions: string[]): Promise<AnalysisResult> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyse the following workshop responses based on these three key questions:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Note: Question 3 is a numeric scale from 1 to 5 (5 is great, 1 is low). 
Interpret any markings like "5th circle shaded", "ticked 4", or "X on 3" as the corresponding numeric value.

Tone and Audience:
- Use professional yet accessible language suitable for students (ages 12-18) and teachers.
- Avoid overly complex jargon.
- Be encouraging but honest about areas for improvement.

Identify:
1. Common themes (with counts of how many responses mention them)
2. Sentiment (Positive, Neutral, Negative with counts)
3. Key keywords (with frequency)
4. Interesting representative quotes
5. A short overall summary of the responses
6. A specific summary for EACH of the three questions provided above.
7. Calculate the average importance score from Question 3 responses. If a response doesn't have a clear number, ignore it for the average.

Responses:
${responses.join('\n---\n')}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          themes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                count: { type: Type.NUMBER }
              },
              required: ["name", "count"]
            }
          },
          sentiment: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                value: { type: Type.NUMBER }
              },
              required: ["name", "value"]
            }
          },
          keywords: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                count: { type: Type.NUMBER }
              },
              required: ["name", "count"]
            }
          },
          quotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          summary: { type: Type.STRING },
          questionSummaries: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                summary: { type: Type.STRING }
              },
              required: ["question", "summary"]
            }
          },
          averageImportance: { type: Type.NUMBER }
        },
        required: ["themes", "sentiment", "keywords", "quotes", "summary", "questionSummaries", "averageImportance"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}
