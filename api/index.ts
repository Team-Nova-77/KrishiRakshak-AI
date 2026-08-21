import { createApp } from '../src/backend/server';
import { IncomingMessage, ServerResponse } from 'http';

let appPromise: any = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
    try {
        if (!appPromise) {
            appPromise = createApp();
        }
        const app = await appPromise;
        return app(req, res);
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


