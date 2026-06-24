import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
readFileSync(join(__dirname, '../public/index.html'), 'utf-8');

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));

const supabase =
    SUPABASE_URL && SUPABASE_KEY
        ? createClient(SUPABASE_URL, SUPABASE_KEY)
        : null;

if (supabase) console.log('📊 Supabase connected!');

app.post('/api/save', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ ok: false, error: 'Database not configured' });
    }

    const data = req.body;

    if (!data.user_id) {
        return res.status(400).json({ ok: false, error: 'user_id is required' });
    }

    const payload = {
        ...data,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('quiz_responses')
        .upsert(payload, { onConflict: 'user_id' });

    if (error) {
        console.error('Supabase error:', error);
        return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({ ok: true });
});

app.post('/api/notify', async (req, res) => {
    if (!TELEGRAM_BOT_TOKEN || !OWNER_CHAT_ID) {
        return res.status(503).json({ ok: false, error: 'Telegram not configured' });
    }

    const data = req.body;

    const message = `
💌 <b>Quiz completed!</b>

🌸 <b>Name:</b> ${data.name || data.user_name || 'Unknown'}
🆔 <b>User ID:</b> ${data.user_id}

✨ <b>Evening Energy:</b> ${data.vibe_choice || '-'}
📍 <b>Place Mood:</b> ${data.food_choice || '-'}
⏰ <b>Chosen Time:</b> ${data.time_choice || '-'}
👗 <b>Final Mood:</b> ${data.dress_choice || '-'}

❌ <b>Wrong clicks:</b> ${data.wrong_clicks ?? 0}
✅ <b>Completed:</b> ${data.completed ? 'Yes' : 'No'}
`;

    try {
        const tgResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: OWNER_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const result = await tgResponse.json();

        if (!result.ok) {
            console.error('Telegram error:', result);
            return res.status(500).json({ ok: false, error: result.description });
        }

        if (supabase && data.user_id) {
            await supabase
                .from('quiz_responses')
                .update({
                    notified: true,
                    completed_at: new Date().toISOString()
                })
                .eq('user_id', data.user_id);
        }

        res.json({ ok: true });
    } catch (e) {
        console.error('Notify error:', e);
        res.status(500).json({ ok: false, error: 'Notification failed' });
    }
});

app.get('/api/responses', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ ok: false, error: 'Database not configured' });
    }

    const { data, error } = await supabase
        .from('quiz_responses')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({ ok: true, data });
});

app.get('/health', (req, res) => {
    res.json({ ok: true, supabase: !!supabase });
});

app.get('*', (req, res) => {
    try {
        let html = readFileSync(join(__dirname, '../public/index.html'), 'utf-8');

        const serverConfig = `
            <script>
                window.SERVER_CONFIG = {
                    API_BASE: ""
                };
            </script>
        `;

        html = html.replace('<head>', `<head>${serverConfig}`);
        res.send(html);
    } catch (e) {
        console.error(e);
        res.status(500).send('Error loading app');
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});