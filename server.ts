import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

// Load environment variables from .env if it exists
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Helper to get the API key with multiple fallback names
  const getApiKey = () => {
    const key = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
    // Check if it's a placeholder or too short to be valid
    if (!key || key === 'YOUR_API_KEY' || key.length < 10) {
      return null;
    }
    return key;
  };

  // API Endpoints
  app.get('/api/status', (req, res) => {
    const apiKey = getApiKey();
    res.json({ 
      isConfigured: !!apiKey,
      message: apiKey ? 'API Key is configured.' : 'GEMINI_API_KEY is missing or invalid.'
    });
  });

  app.post('/api/extract-text', async (req, res) => {
    const { base64Data, mimeType } = req.body;
    const apiKey = getApiKey();
    
    if (!apiKey) {
      return res.status(500).json({ 
        error: 'GEMINI_API_KEY is missing or invalid. Please set it in the AI Studio Secrets panel.' 
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  data: base64Data,
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

      res.json({ text: response.text || "" });
    } catch (error: any) {
      console.error('Extraction error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/analyze-responses', async (req, res) => {
    const { responses, questions } = req.body;
    const apiKey = getApiKey();

    if (!apiKey) {
      return res.status(500).json({ 
        error: 'GEMINI_API_KEY is missing or invalid. Please set it in the AI Studio Secrets panel.' 
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyse the following workshop responses based on these three key questions:
${questions.map((q: string, i: number) => `${i + 1}. ${q}`).join('\n')}

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

      res.json(JSON.parse(response.text || "{}"));
    } catch (error: any) {
      console.error('Analysis error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
