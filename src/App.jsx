import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Calendar, Car, CheckCircle2, Fuel, Loader2, MapPin, Send, Users } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

function getTelegramUser() {
  const tg = window.Telegram?.WebApp;
  return tg?.initDataUnsafe?.user || null;
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
}

function App() {
  const [cars, setCars] = useState([]);
  const [selectedCar, setSelectedCar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [bookingSent, setBookingSent] = useState(false);

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
      .select('*')
      .eq('is_active', true)
      .order('id', { ascending: true });

    if (error) {
      setLoadError(error.message);
    } else {
      setCars(data || []);
    }

    setLoading(false);
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
    if (!form.start_date || !form.end_date) return alert('Выберите даты.');
    if (daysCount <= 0) return alert('Дата окончания должна быть позже даты начала.');

    const { error } = await supabase.from('bookings').insert({
      car_id: selectedCar.id,
      customer_name: form.customer_name,
      phone: form.phone,
      start_date: form.start_date,
      end_date: form.end_date,
      days_count: daysCount,
      total_price: totalPrice,
      status: 'new',
      comment: form.comment || ''
    });

    if (error) {
      alert('Ошибка отправки заявки: ' + error.message);
      return;
    }

    setBookingSent(true);

    const tg = window.Telegram?.WebApp;
    tg?.HapticFeedback?.notificationOccurred?.('success');
  }

  if (bookingSent) {
    return (
      <main className="app success-screen">
        <CheckCircle2 size={56} />
        <h1>Заявка отправлена</h1>
        <p>Менеджер свяжется с вами и подтвердит бронь.</p>
        <button onClick={() => {
          setBookingSent(false);
          setSelectedCar(null);
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

        <section className="hero car-hero">
          <div className="car-icon-big"><Car size={42} /></div>
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
          <label>
            Дата начала
            <input type="date" value={form.start_date} onChange={(e) => updateForm('start_date', e.target.value)} />
          </label>

          <label>
            Дата окончания
            <input type="date" value={form.end_date} onChange={(e) => updateForm('end_date', e.target.value)} />
          </label>

          <div className="price-box">
            <Calendar size={20} />
            <div>
              <b>{daysCount || 0} дней</b>
              <span>Итого: {totalPrice || 0} €</span>
            </div>
          </div>
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

          <button className="primary-btn" onClick={sendBooking}>
            <Send size={18} />
            Отправить заявку
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
          <p>Проверь переменные окружения Supabase и доступ к таблице cars.</p>
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
            <div className="car-thumb">
              <Car size={34} />
            </div>
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
