import { createApp } from '../src/backend/server.js';
import { IncomingMessage, ServerResponse } from 'http';

let appPromise: any = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
    if (!appPromise) {
        appPromise = createApp();
    }
    const app = await appPromise;
    return app(req, res);
}

