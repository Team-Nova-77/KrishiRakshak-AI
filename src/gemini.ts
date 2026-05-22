import { GoogleGenAI } from '@google/genai';

export async function analyzeCropImage(imageBuffer: Buffer, mimeType: string, language: string, mobilenetTags?: string, weatherTemp?: string, weatherCond?: string) {
    // Only initialize when called to prevent crashing if ENV missing on startup
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required');
    }

    const ai = new GoogleGenAI({ apiKey });
    
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
    try {
        // Strip out markdown code blocks if gemini outputs them
        if (text.startsWith("```json")) {
            text = text.replace(/^```json\n?/, "").replace(/```$/, "").trim();
        } else if (text.startsWith("```")) {
            text = text.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim();
        }
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse Gemini output", text);
        throw new Error("Invalid output from AI model.");
    }
}


