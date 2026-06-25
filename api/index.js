import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function formatLabel(key) {
        return key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    function formatValue(value) {
        if (value === true) return 'Yes';
        if (value === false) return 'No';
        if (value === null || value === undefined || value === '') return '—';
        if (Array.isArray(value)) return `${value.length} item(s)`;
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    const preferredOrder = [
        'name',
        'user_name',
        'vibe_choice',
        'food_choice',
        'date_choice',
        'date_iso',
        'time_choice',
        'location_choice',
        'dress_choice',
        'free_note',
        'fortune_message'
    ];

    const hiddenFields = new Set([
        'notified',
        'wrong_answers'
    ]);

    const emojiMap = {
        name: '🌸',
        user_name: '👤',
        user_id: '🆔',
        vibe_choice: '🌙',
        food_choice: '🍽',
        date_choice: '📅',
        date_iso: '🗓',
        time_choice: '🕒',
        location_choice: '📍',
        dress_choice: '👗',
        free_note: '💭',
        fortune_message: '🍪',
        wrong_clicks: '❌',
        completed: '✅',
        completed_at: '🏁'
    };

    const labelMap = {
        name: 'Name',
        user_name: 'Telegram Name',
        user_id: 'User ID',
        vibe_choice: 'Evening',
        food_choice: 'Food / Place Mood',
        date_choice: 'Date',
        date_iso: 'Date ISO',
        time_choice: 'Time',
        location_choice: 'Location',
        dress_choice: 'Mood',
        free_note: 'Note',
        fortune_message: 'Fortune',
        wrong_clicks: 'Wrong Clicks',
        completed: 'Completed',
        completed_at: 'Completed At'
    };

    function fieldLine(key, value) {
        const emoji = emojiMap[key] || '▫️';
        const label = labelMap[key] || formatLabel(key);
        return `${emoji} <b>${escapeHtml(label)}</b>\n${escapeHtml(formatValue(value))}`;
    }

    const orderedKeys = [
        ...preferredOrder.filter(key => key in data),
        ...Object.keys(data).filter(key => !preferredOrder.includes(key))
    ];

    const mainLines = orderedKeys
        .filter(key => !hiddenFields.has(key))
        .filter(key => data[key] !== undefined && data[key] !== null && data[key] !== '')
        .filter(key => key !== 'wrong_clicks' && key !== 'completed' && key !== 'completed_at' && key !== 'user_id')
        .map(key => fieldLine(key, data[key]));

    const wrongAnswersText =
        Array.isArray(data.wrong_answers) && data.wrong_answers.length
            ? data.wrong_answers
                .map((x, i) => {
                    const question = escapeHtml(x.question || 'Unknown question');
                    const answer = escapeHtml(x.answer || 'Unknown answer');
                    return `${i + 1}. <b>${question}</b>\n   ↳ ${answer}`;
                })
                .join('\n\n')
            : 'None';

    const technicalLines = [];

    if (data.user_id) {
        technicalLines.push(`🆔 <b>User ID</b>\n<code>${escapeHtml(data.user_id)}</code>`);
    }

    if ('completed' in data) {
        technicalLines.push(`✅ <b>Completed</b>\n${data.completed ? 'Yes' : 'No'}`);
    }

    if (data.completed_at) {
        technicalLines.push(`🏁 <b>Completed At</b>\n${escapeHtml(data.completed_at)}`);
    }

    const message = [
        '💌 <b>New Date Invitation Response</b>',
        '',
        '━━━━━━━━━━━━━━━━━━',
        '',
        ...mainLines,
        '',
        '━━━━━━━━━━━━━━━━━━',
        '',
        '🎯 <b>Quiz Statistics</b>',
        '',
        `❌ <b>Wrong clicks</b>\n${escapeHtml(data.wrong_clicks ?? 0)}`,
        '',
        wrongAnswersText !== 'None'
            ? `🤭 <b>Choices she wanted first</b>\n\n${wrongAnswersText}`
            : '💖 <b>Choices she wanted first</b>\nNone',
        '',
        '━━━━━━━━━━━━━━━━━━',
        '',
        ...technicalLines
    ].join('\n');

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