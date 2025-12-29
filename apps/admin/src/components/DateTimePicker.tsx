import { useState, useRef, useEffect } from "react";

interface DateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function formatDisplayDate(dateTimeLocal: string): string {
  if (!dateTimeLocal) return "";
  const date = new Date(dateTimeLocal);
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function padZero(n: number): string {
  return n.toString().padStart(2, "0");
}

function toDateTimeLocal(date: Date): string {
  return `${date.getFullYear()}-${padZero(date.getMonth() + 1)}-${padZero(date.getDate())}T${padZero(date.getHours())}:${padZero(date.getMinutes())}`;
}

export function DateTimePicker({
  value,
  onChange,
  disabled = false,
  placeholder = "日時を選択...",
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(
    value ? new Date(value) : null
  );
  const [viewDate, setViewDate] = useState<Date>(
    value ? new Date(value) : new Date()
  );
  const [selectedHour, setSelectedHour] = useState<number>(
    value ? new Date(value).getHours() : 12
  );
  const [selectedMinute, setSelectedMinute] = useState<number>(
    value ? new Date(value).getMinutes() : 0
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      const d = new Date(value);
      setSelectedDate(d);
      setSelectedHour(d.getHours());
      setSelectedMinute(d.getMinutes());
      setViewDate(d);
    } else {
      setSelectedDate(null);
    }
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  const handleDateSelect = (day: number) => {
    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day, selectedHour, selectedMinute);
    setSelectedDate(newDate);
    onChange(toDateTimeLocal(newDate));
  };

  const handleTimeChange = (hour: number, minute: number) => {
    setSelectedHour(hour);
    setSelectedMinute(minute);
    if (selectedDate) {
      const newDate = new Date(selectedDate);
      newDate.setHours(hour, minute);
      setSelectedDate(newDate);
      onChange(toDateTimeLocal(newDate));
    }
  };

  const handlePrevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const handleClear = () => {
    setSelectedDate(null);
    onChange("");
    setIsOpen(false);
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 10, 20, 30, 40, 50];

  const isSelected = (day: number) => {
    if (!selectedDate) return false;
    return (
      selectedDate.getFullYear() === viewDate.getFullYear() &&
      selectedDate.getMonth() === viewDate.getMonth() &&
      selectedDate.getDate() === day
    );
  };

  const isToday = (day: number) => {
    const d = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-lg text-left focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
          value ? "text-zinc-100" : "text-zinc-600"
        }`}
      >
        <div className="flex items-center justify-between">
          <span>{value ? formatDisplayDate(value) : placeholder}</span>
          <svg className="w-5 h-5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 p-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-80">
          {/* Month Navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-medium">
              {viewDate.getFullYear()}年 {viewDate.getMonth() + 1}月
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {["日", "月", "火", "水", "木", "金", "土"].map((day, i) => (
              <div
                key={day}
                className={`text-center text-xs font-medium py-1 ${
                  i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-zinc-500"
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1 mb-4">
            {days.map((day, index) => (
              <div key={index} className="aspect-square">
                {day && (
                  <button
                    type="button"
                    onClick={() => handleDateSelect(day)}
                    className={`w-full h-full flex items-center justify-center text-sm rounded-lg transition-colors ${
                      isSelected(day)
                        ? "bg-violet-600 text-white"
                        : isToday(day)
                        ? "bg-zinc-800 text-violet-400 font-medium"
                        : "hover:bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {day}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Time Selection */}
          <div className="border-t border-zinc-800 pt-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-xs text-zinc-500 mb-1">時</label>
                <select
                  value={selectedHour}
                  onChange={(e) => handleTimeChange(Number(e.target.value), selectedMinute)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-violet-500"
                >
                  {hours.map((h) => (
                    <option key={h} value={h}>
                      {padZero(h)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-zinc-500 pt-4">:</div>
              <div className="flex-1">
                <label className="block text-xs text-zinc-500 mb-1">分（10分刻み）</label>
                <select
                  value={selectedMinute}
                  onChange={(e) => handleTimeChange(selectedHour, Number(e.target.value))}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-violet-500"
                >
                  {minutes.map((m) => (
                    <option key={m} value={m}>
                      {padZero(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleClear}
              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              クリア
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              完了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
