import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const nextDate = new Date(year, month - 1, day);
  if (
    Number.isNaN(nextDate.getTime()) ||
    nextDate.getFullYear() !== year ||
    nextDate.getMonth() !== month - 1 ||
    nextDate.getDate() !== day
  ) {
    return null;
  }
  return nextDate;
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildCalendarDays(displayMonth) {
  const monthStart = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1);
  const monthEnd = new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 0);
  const leadingNulls = monthStart.getDay();
  const cells = [];

  for (let index = 0; index < leadingNulls; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= monthEnd.getDate(); day += 1) {
    cells.push(new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day));
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

export default function CalendarDateField({
  label,
  value,
  onChange,
  placeholder = 'Select date',
  minimumYear = 1940,
  maximumYear = new Date().getFullYear(),
}) {
  const selectedDate = useMemo(() => parseIsoDate(value), [value]);
  const [isVisible, setIsVisible] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => {
    const baseDate = parseIsoDate(value) || new Date(maximumYear - 20, 0, 1);
    return new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  });

  const calendarDays = useMemo(() => buildCalendarDays(displayMonth), [displayMonth]);
  const monthLabel = displayMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const minMonth = new Date(minimumYear, 0, 1);
  const maxMonth = new Date(maximumYear, 11, 1);
  const canGoPrev = displayMonth > minMonth;
  const canGoNext = displayMonth < maxMonth;

  const openCalendar = () => {
    const baseDate = selectedDate || new Date(maximumYear - 20, 0, 1);
    setDisplayMonth(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
    setIsVisible(true);
  };

  const closeCalendar = () => setIsVisible(false);

  const shiftMonth = (offset) => {
    setDisplayMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const handleSelectDate = (date) => {
    onChange(formatIsoDate(date));
    closeCalendar();
  };

  const clearDate = () => {
    onChange('');
    closeCalendar();
  };

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity style={styles.field} onPress={openCalendar} activeOpacity={0.85}>
        <Text style={value ? styles.valueText : styles.placeholderText}>{value || placeholder}</Text>
      </TouchableOpacity>

      <Modal animationType="fade" transparent visible={isVisible} onRequestClose={closeCalendar}>
        <Pressable style={styles.overlay} onPress={closeCalendar}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.header}>
              <TouchableOpacity
                style={[styles.navButton, !canGoPrev && styles.navButtonDisabled]}
                onPress={() => canGoPrev && shiftMonth(-1)}
                disabled={!canGoPrev}
              >
                <Text style={styles.navButtonText}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.headerTitle}>{monthLabel}</Text>
              <TouchableOpacity
                style={[styles.navButton, !canGoNext && styles.navButtonDisabled]}
                onPress={() => canGoNext && shiftMonth(1)}
                disabled={!canGoNext}
              >
                <Text style={styles.navButtonText}>›</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.weekdayRow}>
              {WEEKDAY_LABELS.map((weekday) => (
                <Text key={weekday} style={styles.weekdayText}>
                  {weekday}
                </Text>
              ))}
            </View>

            <View style={styles.calendarGrid}>
              {calendarDays.map((date, index) => {
                const isoDate = date ? formatIsoDate(date) : '';
                const isSelected = Boolean(date && value && isoDate === value);
                return (
                  <TouchableOpacity
                    key={`${isoDate || 'empty'}-${index}`}
                    style={[styles.dayCell, isSelected && styles.dayCellSelected, !date && styles.dayCellPlaceholder]}
                    disabled={!date}
                    onPress={() => date && handleSelectDate(date)}
                  >
                    <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>
                      {date ? date.getDate() : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionButton, styles.secondaryAction]} onPress={closeCalendar}>
                <Text style={styles.secondaryActionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, styles.secondaryAction]} onPress={clearDate}>
                <Text style={styles.secondaryActionText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
  },
  label: {
    color: '#243b53',
    fontWeight: '700',
    marginBottom: 8,
  },
  field: {
    borderWidth: 1,
    borderColor: '#c7d4e2',
    backgroundColor: '#f8fbff',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
  },
  valueText: {
    color: '#14324a',
  },
  placeholderText: {
    color: '#7b8794',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.36)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 18,
    shadowColor: '#0f172a',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#14324a',
  },
  navButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf4fb',
  },
  navButtonDisabled: {
    opacity: 0.45,
  },
  navButtonText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#14324a',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#7b8794',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  dayCell: {
    width: '13.5%',
    aspectRatio: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fbff',
    marginBottom: 8,
  },
  dayCellSelected: {
    backgroundColor: '#0f609b',
  },
  dayCellPlaceholder: {
    backgroundColor: 'transparent',
  },
  dayText: {
    color: '#14324a',
    fontWeight: '700',
  },
  dayTextSelected: {
    color: '#ffffff',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  secondaryAction: {
    backgroundColor: '#edf4fb',
  },
  secondaryActionText: {
    color: '#14324a',
    fontWeight: '700',
  },
});
