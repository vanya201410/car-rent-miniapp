import { createClient } from '@supabase/supabase-js';
import { escapeHtml, telegramApi, getBody } from './_utils.js';

const BUCKET = 'booking-documents';

function parseDataUrl(filePayload) {
  const dataUrl = filePayload?.data_url || '';
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw new Error('Неверный формат файла.');
  }

  return {
    contentType: filePayload.type || match[1] || 'image/jpeg',
    buffer: Buffer.from(match[2], 'base64'),
    name: filePayload.name || `document-${Date.now()}.jpg`
  };
}

function safeName(name) {
  return String(name || 'document.jpg').replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function uploadFile({ supabase, bookingId, filePayload, type }) {
  const parsed = parseDataUrl(filePayload);

  if (parsed.buffer.length > 6 * 1024 * 1024) {
    throw new Error('Файл слишком большой. Загрузите фото меньшего размера.');
  }

  const path = `bookings/${bookingId}/${type}-${Date.now()}-${safeName(parsed.name)}`;

  const { error } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, parsed.buffer, {
      contentType: parsed.contentType,
      upsert: true
    });

  if (error) {
    throw error;
  }

  return path;
}

async function createSignedUrl(supabase, path) {
  if (!path) return null;

  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  if (error) {
    console.error('createSignedUrl error:', error.message);
    return null;
  }

  return data?.signedUrl || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Supabase server variables are missing.' });
    }

    const payload = getBody(req);
    const bookingId = payload.booking_id;
    const phone = String(payload.phone || '').trim();

    if (!bookingId) return res.status(400).json({ error: 'booking_id is required' });
    if (!phone) return res.status(400).json({ error: 'Введите телефон.' });
    if (!payload.driver_license) return res.status(400).json({ error: 'Загрузите фото водительских прав.' });
    if (!payload.identity_document) return res.status(400).json({ error: 'Загрузите фото паспорта / NIE / DNI.' });

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      return res.status(404).json({ error: 'Бронь не найдена.' });
    }

    const { data: car } = await supabase
      .from('cars')
      .select('*')
      .eq('id', booking.car_id)
      .maybeSingle();

    const driverLicensePath = await uploadFile({ supabase, bookingId, filePayload: payload.driver_license, type: 'driver-license' });
    const identityPath = await uploadFile({ supabase, bookingId, filePayload: payload.identity_document, type: 'identity-document' });

    const now = new Date().toISOString();

    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({
        phone,
        documents_status: 'submitted',
        documents_submitted_at: now,
        documents_phone: phone,
        driver_license_path: driverLicensePath,
        identity_document_path: identityPath
      })
      .eq('id', booking.id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    const driverLicenseUrl = await createSignedUrl(supabase, driverLicensePath);
    const identityUrl = await createSignedUrl(supabase, identityPath);

    if (botToken && adminChatId) {
      await telegramApi(botToken, 'sendMessage', {
        chat_id: adminChatId,
        text: [
          '📄 <b>Клиент загрузил документы</b>',
          '',
          `<b>Бронь:</b> #${escapeHtml(updatedBooking.id)}`,
          `<b>Авто:</b> ${escapeHtml(car?.brand || '')} ${escapeHtml(car?.model || '')}`,
          `<b>Даты:</b> ${escapeHtml(updatedBooking.start_date)} — ${escapeHtml(updatedBooking.end_date)}`,
          `<b>Клиент:</b> ${escapeHtml(updatedBooking.customer_name)}`,
          `<b>Телефон:</b> ${escapeHtml(phone)}`,
          '',
          driverLicenseUrl ? `<a href="${escapeHtml(driverLicenseUrl)}">Фото водительских прав</a>` : 'Фото прав загружено в Supabase Storage',
          identityUrl ? `<a href="${escapeHtml(identityUrl)}">Фото паспорта / NIE / DNI</a>` : 'Фото документа загружено в Supabase Storage',
          '',
          'Ссылки действуют 7 дней.'
        ].join('\n'),
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Документы проверены', callback_data: `documents_approved:${booking.id}` }],
            [{ text: '❌ Документы не подходят', callback_data: `documents_rejected:${booking.id}` }]
          ]
        },
        disable_web_page_preview: true
      });
    }

    if (botToken && updatedBooking.telegram_user_id) {
      await telegramApi(botToken, 'sendMessage', {
        chat_id: updatedBooking.telegram_user_id,
        text: [
          '✅ <b>Документы получены</b>',
          '',
          `Бронь #${escapeHtml(updatedBooking.id)}`,
          'Менеджер проверит водительские права и документ, затем свяжется с вами.'
        ].join('\n'),
        parse_mode: 'HTML'
      });
    }

    return res.status(200).json({ ok: true, booking: updatedBooking });
  } catch (error) {
    console.error('upload-documents error:', error);
    return res.status(500).json({ error: error.message || 'Unexpected server error' });
  }
}
