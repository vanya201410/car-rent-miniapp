import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Calendar, Car, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, Fuel, Loader2, MapPin, Send, Upload, Users } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

const INCLUDED_KM_PER_DAY = 200;
const EXTRA_KM_PRICE = 0.25;
const RENTAL_RULES_VERSION = 'v1.0_2026_06';

function isPremiumCar(car) {
  const text = `${car?.brand || ''} ${car?.model || ''}`.toLowerCase();
  const deposit = Number(car?.deposit || 0);
  const pricePerDay = Number(car?.price_per_day || 0);

  return text.includes('jaguar') || deposit >= 800 || pricePerDay >= 120;
}

function calculatePrepaymentAmount(car, daysCount, totalPrice) {
  const total = Math.max(Number(totalPrice || 0), 0);
  if (!total) return 0;

  let amount = 50;

  if (isPremiumCar(car)) {
    amount = 100;
  } else if (Number(daysCount || 0) <= 3) {
    amount = 30;
  } else {
    amount = 50;
  }

  return Math.min(amount, total);
}

const DEFAULT_EXTRA_SERVICES = [
  { code: 'delivery_barcelona', id: 'delivery_barcelona', name: '🚗 Доставка по Барселоне', label: '🚗 Доставка по Барселоне', description: 'Доставка автомобиля в пределах Барселоны', price: 30, price_type: 'fixed', sort_order: 1 },
  { code: 'delivery_airport', id: 'delivery_airport', name: '✈️ Доставка в аэропорт BCN', label: '✈️ Доставка в аэропорт BCN', description: 'Доставка автомобиля в аэропорт Barcelona-El Prat', price: 40, price_type: 'fixed', sort_order: 2 },
  { code: 'child_seat', id: 'child_seat', name: '👶 Детское кресло', label: '👶 Детское кресло', description: 'Детское кресло на весь срок аренды', price: 25, price_type: 'fixed', sort_order: 3 },
  { code: 'additional_driver', id: 'additional_driver', name: '👤 Дополнительный водитель', label: '👤 Дополнительный водитель', description: '10 €/день, максимум 50 €. Требуются документы и права второго водителя.', price: 10, price_type: 'per_day_capped', max_price: 50, sort_order: 4 },
  { code: 'night_service', id: 'night_service', name: '🌙 Ночная выдача/возврат', label: '🌙 Ночная выдача/возврат', description: 'Выдача или возврат с 22:00 до 08:00', price: 30, price_type: 'fixed', sort_order: 5 },
  { code: 'return_other_place', id: 'return_other_place', name: '📍 Возврат в другом месте', label: '📍 Возврат в другом месте', description: 'В пределах Барселоны. За пределами города — по согласованию.', price: 50, price_type: 'fixed', sort_order: 6 },
  { code: 'extra_km_100', id: 'extra_km_100', name: '🛣 Пакет +100 км', label: '🛣 Пакет +100 км', description: 'Дополнительные 100 км к лимиту пробега', price: 20, price_type: 'fixed', extra_km: 100, sort_order: 7 },
  { code: 'extra_km_300', id: 'extra_km_300', name: '🛣 Пакет +300 км', label: '🛣 Пакет +300 км', description: 'Дополнительные 300 км к лимиту пробега', price: 50, price_type: 'fixed', extra_km: 300, sort_order: 8 },
  { code: 'no_wash_return', id: 'no_wash_return', name: '🧽 Возврат без мойки', label: '🧽 Возврат без мойки', description: 'Можно вернуть автомобиль без обычной мойки. Сильное загрязнение оплачивается отдельно.', price: 20, price_type: 'fixed', sort_order: 9 },
  { code: 'cross_border', id: 'cross_border', name: '🌍 Выезд за пределы Испании', label: '🌍 Выезд за пределы Испании', description: 'Только по согласованию с менеджером', price: 0, price_type: 'request', sort_order: 10 }
];

function normalizeExtraService(service) {
  const code = service.code || service.id;
  return {
    ...service,
    id: code,
    code,
    label: service.name || service.label || code,
    name: service.name || service.label || code,
    price: Number(service.price || 0),
    max_price: service.max_price === null || service.max_price === undefined ? null : Number(service.max_price),
    price_type: service.price_type || 'fixed',
    extra_km: Number(service.extra_km || 0),
    sort_order: Number(service.sort_order || 0)
  };
}

function getExtraServicePrice(service, daysCount) {
  if (!service) return 0;

  if (service.price_type === 'request') return 0;

  if (service.price_type === 'per_day_capped') {
    const days = Math.max(Number(daysCount || 1), 1);
    const rawTotal = days * Number(service.price || 0);
    return service.max_price ? Math.min(rawTotal, Number(service.max_price)) : rawTotal;
  }

  return Number(service.price || 0);
}

function getExtraServicePriceText(service, daysCount) {
  if (!service) return '';
  if (service.price_type === 'request') return 'по запросу';
  return `+${getExtraServicePrice(service, daysCount)} €`;
}

function getSelectedExtraCodes(extras) {
  return Object.entries(extras || {})
    .filter(([, value]) => Boolean(value))
    .map(([code]) => code);
}

function calculateIncludedKm(daysCount, extras, extraServices = DEFAULT_EXTRA_SERVICES) {
  const baseKm = Math.max(Number(daysCount || 0), 0) * INCLUDED_KM_PER_DAY;
  const selectedCodes = getSelectedExtraCodes(extras);
  const extraKm = selectedCodes.reduce((sum, code) => {
    const service = extraServices.find((item) => item.code === code || item.id === code);
    return sum + Number(service?.extra_km || 0);
  }, 0);

  return baseKm + extraKm;
}

function calculatePrice(pricePerDay, daysCount, extras, discountRules = [], extraServices = DEFAULT_EXTRA_SERVICES) {
  if (!daysCount || !pricePerDay) {
    return {
      originalBasePrice: 0,
      basePrice: 0,
      discountAmount: 0,
      discountPercent: 0,
      discountLabel: '',
      extrasTotal: 0,
      totalPrice: 0
    };
  }

  const originalBasePrice = Math.round(Number(pricePerDay) * daysCount);

  const applicableRule = [...(discountRules || [])]
    .filter((rule) => rule.is_active !== false && daysCount >= Number(rule.min_days || 0))
    .sort((a, b) => Number(b.min_days || 0) - Number(a.min_days || 0))[0];

  const discountPercent = applicableRule ? Number(applicableRule.discount_percent || 0) : 0;
  const discountAmount = Math.round(originalBasePrice * (discountPercent / 100));
  const basePrice = Math.max(0, originalBasePrice - discountAmount);
  const discountLabel = applicableRule?.label || (discountPercent ? `Скидка ${discountPercent}%` : '');

  const selectedCodes = getSelectedExtraCodes(extras);
  const extrasTotal = selectedCodes.reduce((sum, code) => {
    const service = extraServices.find((item) => item.code === code || item.id === code);
    return sum + getExtraServicePrice(service, daysCount);
  }, 0);

  return {
    originalBasePrice,
    basePrice,
    discountAmount,
    discountPercent,
    discountLabel,
    extrasTotal,
    totalPrice: basePrice + extrasTotal
  };
}

function bookingStatusLabel(status) {
  if (status === 'new') return 'Ожидает подтверждения';
  if (status === 'pending_prepayment') return 'Ожидает предоплату';
  if (status === 'payment_conflict') return 'Оплачено, нужна проверка';
  if (status === 'pending_manual_payment') return 'Ручная оплата';
  if (status === 'confirmed') return 'Подтверждена';
  if (status === 'cancelled') return 'Отменена';
  if (status === 'completed') return 'Завершена';
  return status;
}

function getTelegramUser() {
  const tg = window.Telegram?.WebApp;
  return tg?.initDataUnsafe?.user || null;
}

function parseDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  const diff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function isBusyDate(dateString, busyRanges) {
  return busyRanges.some((range) => dateString >= range.start_date && dateString < range.end_date);
}

function isRangeAvailable(startDate, endDate, busyRanges) {
  if (!startDate || !endDate) return true;
  return !busyRanges.some((range) => startDate < range.end_date && endDate > range.start_date);
}

function buildCalendarDays(monthDate) {
  const first = startOfMonth(monthDate);
  const startWeekDay = (first.getDay() + 6) % 7;
  const calendarStart = addDays(first, -startWeekDay);
  return Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
}

function monthTitle(date) {
  return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function getCarPhotos(car) {
  const fromTable = Array.isArray(car?.car_photos)
    ? [...car.car_photos]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map((photo) => photo.image_url)
        .filter(Boolean)
    : [];

  if (fromTable.length > 0) return fromTable;
  if (car?.image_url) return [car.image_url];
  return [];
}

function CarImage({ car, className = '' }) {
  const photos = getCarPhotos(car);

  if (photos[0]) {
    return <img className={className} src={photos[0]} alt={`${car.brand} ${car.model}`} />;
  }

  return (
    <div className={`image-placeholder ${className}`}>
      <Car size={36} />
    </div>
  );
}


function fileToCompressedImagePayload(file, kind) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Файл не выбран.'));
    if (!String(file.type || '').startsWith('image/')) {
      return reject(new Error('Загрузите фото документа в формате изображения.'));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось обработать фото.'));
      img.onload = () => {
        const maxSide = 1600;
        let { width, height } = img;

        if (width > maxSide || height > maxSide) {
          const ratio = Math.min(maxSide / width, maxSide / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        resolve({
          name: `${kind}-${Date.now()}.jpg`,
          type: 'image/jpeg',
          data_url: dataUrl
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function documentsStatusText(status) {
  if (status === 'submitted') return 'загружены, ожидают проверки';
  if (status === 'approved') return 'проверены';
  if (status === 'rejected') return 'нужно загрузить заново';
  return 'не загружены';
}

function DocumentsUploadCard({ booking, defaultPhone = '', onUploaded }) {
  const [phone, setPhone] = useState(defaultPhone || booking?.phone || '');
  const [driverLicense, setDriverLicense] = useState(null);
  const [identityDoc, setIdentityDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);

  const alreadySubmitted = ['submitted', 'approved'].includes(booking?.documents_status);

  async function uploadDocuments() {
    if (!booking?.id) return alert('Не найден ID брони.');
    if (!phone.trim()) return alert('Введите телефон.');
    if (!driverLicense) return alert('Загрузите фото водительских прав.');
    if (!identityDoc) return alert('Загрузите фото паспорта / NIE / DNI.');

    setLoading(true);
    setNotice(null);

    try {
      const [driverLicensePayload, identityPayload] = await Promise.all([
        fileToCompressedImagePayload(driverLicense, 'driver-license'),
        fileToCompressedImagePayload(identityDoc, 'identity-document')
      ]);

      const response = await fetch('/api/upload-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: booking.id,
          phone,
          driver_license: driverLicensePayload,
          identity_document: identityPayload
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Не удалось загрузить документы.');
      }

      setNotice('✅ Документы загружены. Менеджер проверит их и свяжется с вами.');
      setDriverLicense(null);
      setIdentityDoc(null);
      onUploaded?.(result.booking);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card documents-card">
      <h2>Документы водителя</h2>
      <p className="muted">Для подготовки аренды загрузите фото водительских прав, фото паспорта / NIE / DNI и укажите телефон.</p>
      <p className="hint">Документы нужны для оформления аренды, проверки водителя и возможной идентификации при штрафах.</p>

      {booking?.documents_status && (
        <div className={`documents-status status-${booking.documents_status}`}>
          Статус документов: <b>{documentsStatusText(booking.documents_status)}</b>
        </div>
      )}

      {!alreadySubmitted && (
        <>
          <label>
            Телефон
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+34..." />
          </label>

          <label>
            Фото водительских прав
            <input type="file" accept="image/*" onChange={(e) => setDriverLicense(e.target.files?.[0] || null)} />
          </label>

          <label>
            Фото паспорта / NIE / DNI
            <input type="file" accept="image/*" onChange={(e) => setIdentityDoc(e.target.files?.[0] || null)} />
          </label>

          <button className="secondary-action-btn" onClick={uploadDocuments} disabled={loading}>
            {loading ? <Loader2 size={18} className="spin" /> : <Upload size={18} />}
            {loading ? 'Загружаем...' : '📄 Загрузить документы'}
          </button>
        </>
      )}

      {notice && <p className="success-note">{notice}</p>}
    </section>
  );
}

function PhotoGallery({ car }) {
  const photos = getCarPhotos(car);
  const [index, setIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState(null);

  useEffect(() => {
    setIndex(0);
  }, [car?.id]);

  if (photos.length === 0) {
    return (
      <section className="details-photo-wrap">
        <div className="image-placeholder details-photo"><Car size={42} /></div>
      </section>
    );
  }

  const currentPhoto = photos[index];

  function goPrev() {
    setIndex((prev) => (prev === 0 ? photos.length - 1 : prev - 1));
  }

  function goNext() {
    setIndex((prev) => (prev === photos.length - 1 ? 0 : prev + 1));
  }

  function handleTouchEnd(event) {
    if (touchStartX === null) return;

    const touchEndX = event.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;

    if (Math.abs(diff) > 45) {
      if (diff > 0) goNext();
      else goPrev();
    }

    setTouchStartX(null);
  }

  return (
    <section className="gallery">
      <div
        className="gallery-main"
        onTouchStart={(event) => setTouchStartX(event.touches[0].clientX)}
        onTouchEnd={handleTouchEnd}
      >
        <img className="details-photo" src={currentPhoto} alt={`${car.brand} ${car.model} фото ${index + 1}`} />

        {photos.length > 1 && (
          <>
            <button className="gallery-arrow left" onClick={goPrev} aria-label="Предыдущее фото">
              <ChevronLeft size={20} />
            </button>
            <button className="gallery-arrow right" onClick={goNext} aria-label="Следующее фото">
              <ChevronRight size={20} />
            </button>
            <div className="gallery-counter">
              {index + 1} / {photos.length}
            </div>
          </>
        )}
      </div>

      {photos.length > 1 && (
        <>
          <div className="gallery-dots">
            {photos.map((_, photoIndex) => (
              <button
                key={photoIndex}
                className={photoIndex === index ? 'dot active' : 'dot'}
                onClick={() => setIndex(photoIndex)}
                aria-label={`Фото ${photoIndex + 1}`}
              />
            ))}
          </div>

          <div className="gallery-thumbs">
            {photos.map((photo, photoIndex) => (
              <button
                key={photoIndex}
                className={photoIndex === index ? 'thumb active' : 'thumb'}
                onClick={() => setIndex(photoIndex)}
              >
                <img src={photo} alt={`Миниатюра ${photoIndex + 1}`} />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function VisualCalendar({ startDate, endDate, busyRanges, onChange, loading }) {
  const [month, setMonth] = useState(startOfMonth(new Date()));

  const days = buildCalendarDays(month);
  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  function handleDayClick(day) {
    const dayString = formatDate(day);
    const currentMonth = day.getMonth() === month.getMonth();

    if (!currentMonth) return;

    if (!startDate || (startDate && endDate)) {
      if (isBusyDate(dayString, busyRanges)) {
        alert('Эта дата уже занята. Выберите свободную дату начала.');
        return;
      }

      onChange({ start_date: dayString, end_date: '' });
      return;
    }

    if (dayString <= startDate) {
      alert('Дата возврата должна быть позже даты начала.');
      return;
    }

    if (!isRangeAvailable(startDate, dayString, busyRanges)) {
      alert('Выбранный период пересекается с уже подтверждённой бронью.');
      return;
    }

    onChange({ start_date: startDate, end_date: dayString });
  }

  function getDayClass(day) {
    const dayString = formatDate(day);
    const currentMonth = day.getMonth() === month.getMonth();
    const busy = isBusyDate(dayString, busyRanges);
    const selectedStart = startDate === dayString;
    const selectedEnd = endDate === dayString;
    const inSelectedRange = startDate && endDate && dayString > startDate && dayString < endDate;
    const today = dayString === formatDate(new Date());

    let cls = 'calendar-day';
    if (!currentMonth) cls += ' outside';
    if (busy) cls += ' busy';
    if (selectedStart) cls += ' selected start';
    if (selectedEnd) cls += ' selected end';
    if (inSelectedRange) cls += ' in-range';
    if (today) cls += ' today';

    return cls;
  }

  return (
    <div className="visual-calendar">
      <div className="calendar-header">
        <button type="button" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={18} />
        </button>
        <b>{monthTitle(month)}</b>
        <button type="button" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={18} />
        </button>
      </div>

      {loading && (
        <div className="availability-loading">
          <Loader2 size={16} className="spin" />
          Загружаем занятые даты...
        </div>
      )}

      <div className="calendar-weekdays">
        {weekDays.map((day) => <span key={day}>{day}</span>)}
      </div>

      <div className="calendar-grid">
        {days.map((day) => {
          const dayString = formatDate(day);

          return (
            <button
              type="button"
              key={dayString}
              className={getDayClass(day)}
              onClick={() => handleDayClick(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <div className="calendar-legend">
        <span><i className="legend-free" /> свободно</span>
        <span><i className="legend-busy" /> занято</span>
        <span><i className="legend-selected" /> выбрано</span>
      </div>

      <div className="selected-dates">
        <div>
          <span>Дата начала</span>
          <b>{startDate || 'не выбрана'}</b>
        </div>
        <div>
          <span>Дата возврата</span>
          <b>{endDate || 'не выбрана'}</b>
        </div>
      </div>

      {(startDate || endDate) && (
        <button
          type="button"
          className="clear-dates-btn"
          onClick={() => onChange({ start_date: '', end_date: '' })}
        >
          Очистить даты
        </button>
      )}
    </div>
  );
}

function App() {
  const [view, setView] = useState('catalog');
  const [cars, setCars] = useState([]);
  const [discountRules, setDiscountRules] = useState([]);
  const [extraServices, setExtraServices] = useState(DEFAULT_EXTRA_SERVICES);
  const [selectedCar, setSelectedCar] = useState(null);
  const [busyRanges, setBusyRanges] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [myBookingsLoading, setMyBookingsLoading] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [bookingSent, setBookingSent] = useState(false);
  const [sentBooking, setSentBooking] = useState(null);
  const [sending, setSending] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [manualPaymentLoading, setManualPaymentLoading] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState(null);
  const [extras, setExtras] = useState({});
  const [rulesAccepted, setRulesAccepted] = useState(false);

  const [form, setForm] = useState({
    customer_name: '',
    phone: '',
    start_date: '',
    end_date: '',
    comment: ''
  });

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();

    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const bookingId = params.get('booking_id');

    if (payment === 'success') {
      setPaymentNotice({
        type: 'success',
        text: `✅ Оплата отправлена. Stripe подтверждает платеж, бронь #${bookingId || ''} скоро обновится.`
      });
      window.history.replaceState({}, '', window.location.pathname);
    }

    if (payment === 'cancel') {
      setPaymentNotice({
        type: 'warning',
        text: `Оплата отменена. Бронь #${bookingId || ''} осталась в ожидании предоплаты.`
      });
      window.history.replaceState({}, '', window.location.pathname);
    }

    const user = getTelegramUser();
    if (user?.first_name) {
      setForm((prev) => ({ ...prev, customer_name: user.first_name }));
    }

    loadCars();
    loadDiscountRules();
    loadExtraServices();
  }, []);

  useEffect(() => {
    if (selectedCar?.id) {
      setForm((prev) => ({ ...prev, start_date: '', end_date: '' }));
      setExtras({});
      setRulesAccepted(false);
      loadAvailability(selectedCar.id);
    }
  }, [selectedCar?.id]);

  async function loadCars() {
    setLoading(true);
    setLoadError('');

    if (!supabaseUrl || !supabaseAnonKey) {
      setLoadError('Не указаны переменные VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY.');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('cars')
      .select('*, car_photos(id, image_url, sort_order)')
      .eq('is_active', true)
      .order('id', { ascending: true });

    if (error) {
      setLoadError(error.message);
    } else {
      setCars(data || []);
    }

    setLoading(false);
  }

  async function loadDiscountRules() {
    try {
      const response = await fetch('/api/discount-rules');
      const result = await response.json();

      if (response.ok) {
        setDiscountRules(result.discount_rules || []);
      }
    } catch (error) {
      console.warn('Не удалось загрузить правила скидок:', error);
    }
  }

  async function loadExtraServices() {
    try {
      const response = await fetch('/api/extra-services');
      const result = await response.json();

      if (response.ok && Array.isArray(result.extra_services) && result.extra_services.length > 0) {
        setExtraServices(result.extra_services.map(normalizeExtraService));
      }
    } catch (error) {
      console.warn('Не удалось загрузить доп. услуги, используем стандартный список:', error);
    }
  }

  async function loadAvailability(carId) {
    setAvailabilityLoading(true);
    setBusyRanges([]);

    try {
      const response = await fetch(`/api/car-availability?car_id=${carId}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Ошибка загрузки занятых дат');
      }

      setBusyRanges(result.busy_ranges || []);
    } catch (error) {
      alert('Не удалось загрузить занятые даты: ' + error.message);
    } finally {
      setAvailabilityLoading(false);
    }
  }

  async function loadMyBookings() {
    const tgUser = getTelegramUser();

    if (!tgUser?.id) {
      alert('Раздел “Мои бронирования” работает только внутри Telegram.');
      return;
    }

    setView('myBookings');
    setMyBookingsLoading(true);

    try {
      const response = await fetch(`/api/my-bookings?telegram_user_id=${tgUser.id}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Ошибка загрузки бронирований');
      }

      setMyBookings(result.bookings || []);
    } catch (error) {
      alert(error.message);
    } finally {
      setMyBookingsLoading(false);
    }
  }

  function toggleExtra(serviceId) {
    setExtras((prev) => {
      const next = { ...prev };

      if (next[serviceId]) {
        delete next[serviceId];
        return next;
      }

      // Эти услуги взаимоисключающие: клиент выбирает только одну доставку.
      if (serviceId === 'delivery_barcelona') delete next.delivery_airport;
      if (serviceId === 'delivery_airport') delete next.delivery_barcelona;

      // Клиент выбирает только один пакет дополнительных километров.
      if (serviceId === 'extra_km_100') delete next.extra_km_300;
      if (serviceId === 'extra_km_300') delete next.extra_km_100;

      next[serviceId] = true;
      return next;
    });
  }

  const daysCount = useMemo(() => daysBetween(form.start_date, form.end_date), [form.start_date, form.end_date]);
  const priceBreakdown = useMemo(() => {
    if (!selectedCar) return { originalBasePrice: 0, basePrice: 0, discountAmount: 0, discountPercent: 0, discountLabel: '', extrasTotal: 0, totalPrice: 0 };
    return calculatePrice(selectedCar.price_per_day, daysCount, extras, discountRules, extraServices);
  }, [selectedCar, daysCount, extras, discountRules, extraServices]);

  const totalPrice = priceBreakdown.totalPrice;
  const prepaymentAmount = useMemo(
    () => calculatePrepaymentAmount(selectedCar, daysCount, totalPrice),
    [selectedCar, daysCount, totalPrice]
  );
  const remainingAmount = Math.max(0, Number(totalPrice || 0) - Number(prepaymentAmount || 0));
  const includedKm = useMemo(() => calculateIncludedKm(daysCount, extras, extraServices), [daysCount, extras, extraServices]);
  const selectedExtraCodes = useMemo(() => getSelectedExtraCodes(extras), [extras]);

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function sendBooking() {
    if (!selectedCar) return alert('Выберите автомобиль.');
    if (!form.customer_name.trim()) return alert('Введите имя.');
    if (!form.phone.trim()) return alert('Введите телефон.');
    if (!form.start_date || !form.end_date) return alert('Выберите даты в календаре.');
    if (daysCount <= 0) return alert('Дата возврата должна быть позже даты начала.');
    if (!rulesAccepted) return alert('Перед отправкой заявки нужно принять правила аренды.');
    if (!isRangeAvailable(form.start_date, form.end_date, busyRanges)) {
      return alert('Выбранный период пересекается с уже подтверждённой бронью.');
    }

    setSending(true);

    try {
      const tgUser = getTelegramUser();

      const response = await fetch('/api/create-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          car_id: selectedCar.id,
          customer_name: form.customer_name,
          phone: form.phone,
          start_date: form.start_date,
          end_date: form.end_date,
          days_count: daysCount,
          base_price: priceBreakdown.basePrice,
          discount_percent: priceBreakdown.discountPercent,
          discount_amount: priceBreakdown.discountAmount,
          discount_label: priceBreakdown.discountLabel,
          extras_total: priceBreakdown.extrasTotal,
          extras,
          selected_extra_service_codes: selectedExtraCodes,
          included_km: includedKm,
          included_km_per_day: INCLUDED_KM_PER_DAY,
          extra_km_price: EXTRA_KM_PRICE,
          rules_accepted: rulesAccepted,
          rules_version: RENTAL_RULES_VERSION,
          prepayment_amount: prepaymentAmount,
          remaining_amount: remainingAmount,
          total_price: totalPrice,
          comment: form.comment || '',
          telegram_user_id: tgUser?.id ? String(tgUser.id) : null,
          telegram_username: tgUser?.username || null
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Ошибка отправки заявки');
      }

      setSentBooking(result.booking || null);
      setBookingSent(true);

      const tg = window.Telegram?.WebApp;
      tg?.HapticFeedback?.notificationOccurred?.('success');
    } catch (error) {
      alert(error.message);
    } finally {
      setSending(false);
    }
  }


  async function payPrepayment(bookingId) {
    if (!bookingId) return alert('Не найден ID брони.');

    setPaymentLoading(true);

    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Не удалось создать ссылку на оплату');
      }

      if (!result.checkout_url) {
        throw new Error('Stripe не вернул ссылку на оплату.');
      }

      window.location.href = result.checkout_url;
    } catch (error) {
      alert(error.message);
      setPaymentLoading(false);
    }
  }

  async function requestManualPayment(bookingId) {
    if (!bookingId) return alert('Не найден ID брони.');

    setManualPaymentLoading(true);

    try {
      const response = await fetch('/api/manual-payment-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Не удалось отправить запрос менеджеру.');
      }

      alert('Запрос отправлен менеджеру. Бронь пока не подтверждена.');

      if (result.booking) {
        setSentBooking((prev) => (prev?.id === result.booking.id ? result.booking : prev));
        setMyBookings((prev) => prev.map((item) => item.id === result.booking.id ? { ...item, ...result.booking } : item));
      }
    } catch (error) {
      alert(error.message);
    } finally {
      setManualPaymentLoading(false);
    }
  }

  function updateBookingInState(updatedBooking) {
    if (!updatedBooking) return;
    setSentBooking((prev) => (prev?.id === updatedBooking.id ? { ...prev, ...updatedBooking } : prev));
    setMyBookings((prev) => prev.map((item) => item.id === updatedBooking.id ? { ...item, ...updatedBooking } : item));
  }


  if (view === 'myBookings') {
    return (
      <main className="app">
        <button className="back-btn" onClick={() => setView('catalog')}>← В каталог</button>

        <section className="hero">
          <div className="logo-circle"><Calendar size={36} /></div>
          <h1>Мои бронирования</h1>
          <p>Здесь отображаются заявки, отправленные из вашего Telegram.</p>
        </section>

        {myBookingsLoading && (
          <div className="center">
            <Loader2 className="spin" />
            <p>Загружаем бронирования...</p>
          </div>
        )}

        {!myBookingsLoading && myBookings.length === 0 && (
          <section className="card">
            <h2>Пока нет бронирований</h2>
            <p>Выберите автомобиль и отправьте первую заявку.</p>
          </section>
        )}

        <section className="booking-list">
          {myBookings.map((booking) => (
            <article className={`booking-card status-${booking.status}`} key={booking.id}>
              <div className="booking-card-header">
                <h2>{booking.car?.brand || 'Авто'} {booking.car?.model || ''}</h2>
                <span>{bookingStatusLabel(booking.status)}</span>
              </div>
              <p>{booking.start_date} — {booking.end_date}</p>
              <p>{booking.days_count} дней · {booking.total_price} €</p>
              {booking.prepayment_amount > 0 && <p>Предоплата: {booking.prepayment_amount} € · {booking.prepayment_status === 'paid' ? 'оплачена' : 'ожидается'}</p>}
              {booking.prepayment_amount > 0 && booking.prepayment_status !== 'paid' && (
                <div className="booking-actions">
                  <button className="payment-btn small" onClick={() => payPrepayment(booking.id)} disabled={paymentLoading}>
                    <CreditCard size={16} />
                    {paymentLoading ? 'Открываем оплату...' : 'Оплатить предоплату картой'}
                  </button>
                  <button className="manual-payment-btn small" onClick={() => requestManualPayment(booking.id)} disabled={manualPaymentLoading}>
                    ❓ Не могу оплатить онлайн
                  </button>
                </div>
              )}
              {booking.online_payment_status === 'manual_requested' && <p className="manual-status">Запрос ручной оплаты отправлен менеджеру.</p>}
              {booking.remaining_amount !== null && booking.remaining_amount !== undefined && <p>Остаток при получении: {booking.remaining_amount} €</p>}
              {booking.extras_total > 0 && <p>Доп. услуги: {booking.extras_total} €</p>}
              {booking.included_km && <p>Включено: {booking.included_km} км</p>}
              {booking.extra_km_price && <p>Доп. км: {booking.extra_km_price} €/км</p>}
              {booking.deposit_status && booking.deposit_status !== 'not_received' && <p>Залог: {booking.deposit_status === 'received' ? 'получен' : booking.deposit_status === 'returned' ? 'возвращен' : booking.deposit_status === 'partially_held' ? `удержано ${booking.deposit_held_amount || 0} €` : booking.deposit_status}</p>}
              {booking.pre_rental_photos_status === 'uploaded' && <p>Фото до выдачи: загружены ✅</p>}
              {booking.post_rental_photos_status === 'uploaded' && <p>Фото после возврата: загружены ✅</p>}
              {booking.return_status && booking.return_status !== 'not_returned' && <p>Возврат авто: {booking.return_status}</p>}
              {booking.has_pending_charges && <p className="manual-status">Есть дополнительные начисления / штрафы. Менеджер свяжется с вами.</p>}
              {booking.status !== 'cancelled' && (
                <DocumentsUploadCard booking={booking} defaultPhone={booking.phone || ''} onUploaded={updateBookingInState} />
              )}
            </article>
          ))}
        </section>
      </main>
    );
  }

  if (bookingSent) {
    return (
      <main className="app success-screen">
        <CheckCircle2 size={56} />
        <h1>Заявка отправлена</h1>
        <p>Менеджер получил уведомление в Telegram и скоро свяжется с вами.</p>
        {sentBooking?.prepayment_amount > 0 && (
          <section className="card prepayment-card">
            <h2>Предоплата для фиксации брони</h2>
            <p><b>{sentBooking.prepayment_amount} €</b> — нужно внести, чтобы закрепить автомобиль за вами.</p>
            <p>Предоплата входит в стоимость аренды.</p>
            <p>Остаток при получении автомобиля: <b>{sentBooking.remaining_amount} €</b></p>
            <p>Залог оплачивается отдельно при получении автомобиля.</p>
            <button className="payment-btn" onClick={() => payPrepayment(sentBooking.id)} disabled={paymentLoading}>
              <CreditCard size={18} />
              {paymentLoading ? 'Открываем оплату...' : '💳 Оплатить предоплату онлайн'}
            </button>
            <button className="manual-payment-btn" onClick={() => requestManualPayment(sentBooking.id)} disabled={manualPaymentLoading}>
              ❓ Не могу оплатить онлайн
            </button>
            {sentBooking.online_payment_status === 'manual_requested' && <p className="manual-status">Запрос ручной оплаты отправлен менеджеру.</p>}
            <p className="hint">После оплаты Stripe автоматически отметит предоплату как оплаченную.</p>
          </section>
        )}
        {sentBooking && (
          <DocumentsUploadCard booking={sentBooking} defaultPhone={form.phone} onUploaded={updateBookingInState} />
        )}
        <button onClick={() => {
          setBookingSent(false);
          setSentBooking(null);
          setSelectedCar(null);
          setBusyRanges([]);
          setForm({ customer_name: '', phone: '', start_date: '', end_date: '', comment: '' });
          setExtras({});
          setRulesAccepted(false);
        }}>
          Вернуться в каталог
        </button>
      </main>
    );
  }

  if (selectedCar) {
    return (
      <main className="app">
        <button className="back-btn" onClick={() => setSelectedCar(null)}>← Назад</button>

        <PhotoGallery car={selectedCar} />

        <section className="hero car-hero">
          <h1>{selectedCar.brand} {selectedCar.model}</h1>
          <p>{selectedCar.year} · {selectedCar.city}</p>
        </section>

        <section className="card">
          <h2>{selectedCar.price_per_day} € / день</h2>
          <p className="muted">Залог: {selectedCar.deposit} €</p>

          <div className="spec-grid">
  <div><Car size={18} /> {selectedCar.transmission}</div>
  <div><Fuel size={18} /> {selectedCar.fuel_type}</div>
  <div><Users size={18} /> {selectedCar.seats} мест</div>
  <div><MapPin size={18} /> {selectedCar.city}</div>
  {selectedCar.fuel_consumption && (
    <div><Fuel size={18} /> Расход: {selectedCar.fuel_consumption}</div>
  )}
</div>

          <p>{selectedCar.description}</p>
        </section>

        <section className="card">
          <h2>Выберите даты</h2>

          <VisualCalendar
            startDate={form.start_date}
            endDate={form.end_date}
            busyRanges={busyRanges}
            loading={availabilityLoading}
            onChange={(dates) => {
              updateForm('start_date', dates.start_date);
              updateForm('end_date', dates.end_date);
            }}
          />

          <div className="price-box">
            <Calendar size={20} />
            <div>
              <b>{daysCount || 0} дней</b>
              <span>Аренда: {priceBreakdown.basePrice || 0} €</span>
              {priceBreakdown.discountAmount > 0 && <span>Без скидки: {priceBreakdown.originalBasePrice} €</span>}
              {priceBreakdown.discountAmount > 0 && <span>Скидка: −{priceBreakdown.discountAmount} € · {priceBreakdown.discountLabel}</span>}
              {priceBreakdown.extrasTotal > 0 && <span>Доп. услуги: {priceBreakdown.extrasTotal} €</span>}
              <span>Включено: {includedKm || 0} км ({INCLUDED_KM_PER_DAY} км/день)</span>
              <span>Доп. км сверх лимита: {EXTRA_KM_PRICE} €/км</span>
              {prepaymentAmount > 0 && <span>Предоплата для фиксации: {prepaymentAmount} €</span>}
              {prepaymentAmount > 0 && <span>Остаток при получении: {remainingAmount} €</span>}
              <span>Итого: {totalPrice || 0} €</span>
            </div>
          </div>

          <p className="hint">
            Красные даты заняты подтверждёнными бронями. Дата возврата не считается занятым днём.
          </p>

          {discountRules.length > 0 && (
            <div className="discount-rules-box">
              <b>Скидки за длительную аренду</b>
              {discountRules.map((rule) => (
                <span key={rule.id}>
                  от {rule.min_days} дней — {rule.discount_percent}% {rule.label ? `· ${rule.label}` : ''}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Дополнительные услуги</h2>
          <div className="extras-list">
            {extraServices.map((service) => (
              <label className="extra-item" key={service.code}>
                <input
                  type="checkbox"
                  checked={Boolean(extras[service.code])}
                  onChange={() => toggleExtra(service.code)}
                />
                <span>
                  {service.label}
                  {service.description && <small>{service.description}</small>}
                </span>
                <b>{getExtraServicePriceText(service, daysCount)}</b>
              </label>
            ))}
          </div>
        </section>

        <section className="card prepayment-card">
          <h2>Предоплата</h2>
          <div className="mileage-box">
            <b>Для фиксации брони: {prepaymentAmount || 0} €</b>
            <span>Предоплата входит в стоимость аренды.</span>
            <span>Остаток при получении автомобиля: {remainingAmount || 0} €</span>
            <span>Залог оплачивается отдельно при получении автомобиля.</span>
          </div>
          <p className="hint">После отправки заявки менеджер пришлет реквизиты. Бронь подтверждается после поступления предоплаты.</p>
        </section>

        <section className="card rules-card">
          <h2>Пробег и правила аренды</h2>

          <div className="mileage-box">
            <b>В стоимость включено: {INCLUDED_KM_PER_DAY} км/день</b>
            <span>На выбранный срок: {includedKm || 0} км</span>
            <span>Дополнительный пробег сверх лимита: {EXTRA_KM_PRICE} €/км</span>
          </div>

          <div className="rules-text">
            <p><b>Основные условия аренды:</b></p>
            <p>Депозит возвращается после проверки автомобиля, если нет новых повреждений, штрафов, задолженностей, превышения пробега или нарушения условий аренды.</p>
            <p>Автомобиль выдается и возвращается с зафиксированным уровнем топлива. Если топлива меньше, клиент оплачивает недостающее топливо и сервисный сбор 20 €.</p>
            <p>Опоздание до 30 минут — бесплатно. Опоздание более 30 минут — 20 €. Опоздание более 2 часов может считаться дополнительным днем аренды.</p>
            <p>Перед выдачей и возвратом автомобиля делаются фото/видео. Клиент отвечает за новые повреждения, появившиеся во время аренды.</p>
            <p>Штрафы, парковки, камеры, платные дороги и эвакуация оплачиваются клиентом. Если штраф приходит после аренды, клиент также обязан оплатить его. За обработку штрафа может взиматься административный сбор 25 €.</p>
            <p>Отмена более чем за 48 часов — бесплатно. Отмена за 24–48 часов — удерживается 50% предоплаты. Отмена менее чем за 24 часа — предоплата не возвращается.</p>
            <p>Минимальный возраст водителя — 21 год, стаж — от 2 лет. Для премиум-авто — от 25 лет и стаж от 5 лет.</p>
            <p>Для аренды нужны паспорт/DNI/NIE, водительские права и контактный телефон. Для не-EU прав может потребоваться международное водительское удостоверение или официальный перевод.</p>
            <p>Запрещено передавать авто другому водителю без согласования, курить в салоне, использовать авто для гонок/дрифта, выезжать за пределы Испании без согласования.</p>
          </div>

          <label className="rules-checkbox">
            <input
              type="checkbox"
              checked={rulesAccepted}
              onChange={(e) => setRulesAccepted(e.target.checked)}
            />
            <span>Я прочитал(а) и принимаю правила аренды, условия депозита, пробега, штрафов, топлива, отмены и ответственности за автомобиль.</span>
          </label>
        </section>

        <section className="card">
          <h2>Ваши данные</h2>
          <label>
            Имя
            <input value={form.customer_name} onChange={(e) => updateForm('customer_name', e.target.value)} placeholder="Например, Иван" />
          </label>

          <label>
            Телефон
            <input value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} placeholder="+34..." />
          </label>

          <label>
            Комментарий
            <textarea value={form.comment} onChange={(e) => updateForm('comment', e.target.value)} placeholder="Где удобно получить авто, вопросы, пожелания" />
          </label>

          {!rulesAccepted && <p className="rules-warning">Чтобы отправить заявку, примите правила аренды выше.</p>}

          <button className="primary-btn" onClick={sendBooking} disabled={sending || !rulesAccepted}>
            {sending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            {sending ? 'Отправляем...' : 'Отправить заявку'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <section className="hero">
        <div className="logo-circle"><Car size={36} /></div>
        <h1>Аренда авто</h1>
        <p>Выберите автомобиль, даты и отправьте заявку прямо в Telegram.</p>
        <div className="hero-actions">
          <button className="secondary-btn" onClick={loadMyBookings}>📋 Мои бронирования</button>
        </div>
      </section>

      {paymentNotice && (
        <section className={`payment-notice ${paymentNotice.type}`}>
          <span>{paymentNotice.text}</span>
          <button type="button" onClick={() => setPaymentNotice(null)}>×</button>
        </section>
      )}

      {loading && (
        <div className="center">
          <Loader2 className="spin" />
          <p>Загружаем автомобили...</p>
        </div>
      )}

      {loadError && (
        <section className="error-card">
          <b>Ошибка подключения</b>
          <p>{loadError}</p>
          <p>Проверь переменные окружения Supabase и доступ к таблице cars/car_photos.</p>
        </section>
      )}

      {!loading && !loadError && cars.length === 0 && (
        <section className="card">
          <h2>Пока нет машин</h2>
          <p>Добавьте первую машину в Supabase → Table Editor → cars.</p>
        </section>
      )}

      <section className="cars-list">
        {cars.map((car) => (
          <article className="car-card" key={car.id} onClick={() => setSelectedCar(car)}>
            <CarImage car={car} className="car-thumb" />
            <div>
              <h2>{car.brand} {car.model}</h2>
              <p>{car.year} · {car.transmission} · {car.fuel_type}</p>
              <b>{car.price_per_day} € / день</b>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
