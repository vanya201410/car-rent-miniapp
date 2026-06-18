import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Calendar, Car, CheckCircle2, ChevronLeft, ChevronRight, Fuel, Loader2, MapPin, Send, Users } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

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
  const [cars, setCars] = useState([]);
  const [selectedCar, setSelectedCar] = useState(null);
  const [busyRanges, setBusyRanges] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [bookingSent, setBookingSent] = useState(false);
  const [sending, setSending] = useState(false);

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

    const user = getTelegramUser();
    if (user?.first_name) {
      setForm((prev) => ({ ...prev, customer_name: user.first_name }));
    }

    loadCars();
  }, []);

  useEffect(() => {
    if (selectedCar?.id) {
      setForm((prev) => ({ ...prev, start_date: '', end_date: '' }));
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

  const daysCount = useMemo(() => daysBetween(form.start_date, form.end_date), [form.start_date, form.end_date]);
  const totalPrice = useMemo(() => {
    if (!selectedCar || !daysCount) return 0;
    return Number(selectedCar.price_per_day || 0) * daysCount;
  }, [selectedCar, daysCount]);

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function sendBooking() {
    if (!selectedCar) return alert('Выберите автомобиль.');
    if (!form.customer_name.trim()) return alert('Введите имя.');
    if (!form.phone.trim()) return alert('Введите телефон.');
    if (!form.start_date || !form.end_date) return alert('Выберите даты в календаре.');
    if (daysCount <= 0) return alert('Дата возврата должна быть позже даты начала.');
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

      setBookingSent(true);

      const tg = window.Telegram?.WebApp;
      tg?.HapticFeedback?.notificationOccurred?.('success');
    } catch (error) {
      alert(error.message);
    } finally {
      setSending(false);
    }
  }

  if (bookingSent) {
    return (
      <main className="app success-screen">
        <CheckCircle2 size={56} />
        <h1>Заявка отправлена</h1>
        <p>Менеджер получил уведомление в Telegram и скоро свяжется с вами.</p>
        <button onClick={() => {
          setBookingSent(false);
          setSelectedCar(null);
          setBusyRanges([]);
          setForm({ customer_name: '', phone: '', start_date: '', end_date: '', comment: '' });
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
              <span>Итого: {totalPrice || 0} €</span>
            </div>
          </div>

          <p className="hint">
            Красные даты заняты подтверждёнными бронями. Дата возврата не считается занятым днём.
          </p>
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

          <button className="primary-btn" onClick={sendBooking} disabled={sending}>
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
      </section>

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
