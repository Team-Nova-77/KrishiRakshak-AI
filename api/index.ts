import { createApp } from '../src/backend/server.js';

let appInstance: any = null;

export default async function handler(req: any, res: any) {
    try {
        if (!appInstance) {
            appInstance = await createApp();
        }
        return appInstance(req, res);
    } catch (err: any) {
        console.error('[Vercel Serverless Function Error]', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            error: err.message || 'Internal Serverless Execution Error',
            details: String(err)
        }));
    }
}
