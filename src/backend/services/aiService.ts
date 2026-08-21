import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { GEMINI_API_KEY, GROQ_API_KEY } from '../config/env.js';

async function analyzeWithGroq(imageBuffer: Buffer, mimeType: string, prompt: string): Promise<any> {
    const groqKey = GROQ_API_KEY;
    if (!groqKey || groqKey === 'your_groq_api_key_here') {
        throw new Error('GROQ_API_KEY environment variable is required for Groq backup analysis');
    }

    const client = new OpenAI({
        apiKey: groqKey,
        baseURL: 'https://api.groq.com/openai/v1',
    });

    const base64Data = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    // Groq vision models list (with fallback order for model deprecations)
    const visionModels = [
        'llama-3.2-90b-vision-preview',
        'llama-3.2-11b-vision-instruct',
        'llama-3.2-90b-vision-instruct'
    ];

    let lastError: any = null;

    for (const model of visionModels) {
        try {
            console.log(`[KrishiRakshak AI] Attempting Groq Vision AI with model: ${model}...`);
            const completion = await client.chat.completions.create({
                model: model,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: dataUrl } }
                        ]
                    }
                ]
            });

            let text = completion.choices[0]?.message?.content || '{}';
            if (text.startsWith("```json")) {
                text = text.replace(/^```json\n?/, "").replace(/```$/, "").trim();
            } else if (text.startsWith("```")) {
                text = text.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim();
            }
            return JSON.parse(text);
        } catch (err: any) {
            console.warn(`[KrishiRakshak AI] Groq model '${model}' failed or decommissioned:`, err?.message || err);
            lastError = err;
        }
    }

    throw lastError || new Error("Failed to generate response from Groq Vision AI models.");
}

export async function analyzeCropImage(
    imageBuffer: Buffer,
    mimeType: string,
    language: string,
    mobilenetTags?: string,
    weatherTemp?: string,
    weatherCond?: string
) {
    const geminiKey = GEMINI_API_KEY;
    const groqKey = GROQ_API_KEY;

    const hasGemini = geminiKey && geminiKey !== 'your_gemini_api_key_here';
    const hasGroq = groqKey && groqKey !== 'your_groq_api_key_here';

    if (!hasGemini && !hasGroq) {
        throw new Error('Neither GEMINI_API_KEY nor GROQ_API_KEY environment variable is set');
    }

    // Map language code to full language name
    const langMap: Record<string, string> = {
        en: "English",
        hi: "Hindi",
        mr: "Marathi"
    };
    const langName = langMap[language] || "English";
    
    // Construct localized instructions
    const prompt = `You are KrishiRakshak AI, an expert agricultural advisor. Analyze this crop image.
    The response must be in strictly valid JSON format.
    MANDATORY INSTRUCTION: You MUST output ALL string values (status, disease, severity, alerts, tips, recommendations) fully translated into this language: ${langName}.
    ${mobilenetTags ? `\n    Note: A local MobileNetV2 model has pre-analyzed this image and detected the following potential objects/features: ${mobilenetTags}. You may use this as additional context if relevant to crop health, but rely primarily on your own vision analysis.\n` : ''}
    ${weatherTemp && weatherCond ? `\n    CRITICAL CONTEXT: The current weather at the farm is: Temp: ${weatherTemp}°C, Condition: ${weatherCond}. You MUST highly tailor your irrigationRecommendation, fertilizerRecommendation, and fieldManagementSupport to both the detected crop health status AND these specific weather conditions. For example, if it is raining, advise on rain runoff, avoiding washing off fertilizers, and altering watering. If it is dry and hot, advise on watering times and evaporation management.\n` : ''}
    JSON Schema:
    {
      "status": "<translated health status (e.g. Healthy, Mild Risk, Moderate Risk, High Risk)>",
      "healthScore": <integer 0-100>,
      "disease": "<translated disease name or 'None'>",
      "confidence": <integer 0-100>,
      "severity": "<translated severity (Low, Medium, High, None)>",
      "alerts": ["alert 1", "alert 2"],
      "fertilizerRecommendation": "<string>",
      "irrigationRecommendation": "<string>",
      "fieldManagementSupport": "<string>",
      "preventionAdvice": ["tip 1", "tip 2"]
    }

    The analysis must look closely for visible diseases, nutrient deficiency, dryness, discoloration, and overall health. 
    Act as an expert agricultural monitoring platform (not just a disease classifier). Provide practical field management advice for real farmers.`;

    if (hasGemini) {
        try {
            const ai = new GoogleGenAI({ apiKey: geminiKey! });
            const response = await ai.models.generateContent({
                model: 'gemini-3.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { inlineData: { data: imageBuffer.toString('base64'), mimeType: mimeType } },
                            { text: prompt }
                        ]
                    }
                ],
                config: {
                    responseMimeType: "application/json"
                }
            });

            let text = response.text || "{}";
            if (text.startsWith("```json")) {
                text = text.replace(/^```json\n?/, "").replace(/```$/, "").trim();
            } else if (text.startsWith("```")) {
                text = text.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim();
            }
            return JSON.parse(text);
        } catch (geminiErr: any) {
            console.warn("[KrishiRakshak AI] Gemini API failed or quota exhausted:", geminiErr?.message || geminiErr);
            if (hasGroq) {
                console.log("[KrishiRakshak AI] Falling back to Groq Vision AI provider...");
                return await analyzeWithGroq(imageBuffer, mimeType, prompt);
            }
            throw geminiErr;
        }
    } else {
        console.log("[KrishiRakshak AI] GEMINI_API_KEY missing. Using Groq Vision AI provider...");
        return await analyzeWithGroq(imageBuffer, mimeType, prompt);
    }
}
