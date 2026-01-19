use chrono::{Datelike, Duration, LocalResult, NaiveDate, TimeZone, Weekday, Utc};

use crate::models::RepeatRule;

pub fn next_due_timestamp(due_at: i64, repeat: &RepeatRule) -> i64 {
    next_due_timestamp_in_timezone(chrono::Local, due_at, repeat)
}

fn next_due_timestamp_in_timezone<Tz>(tz: Tz, due_at: i64, repeat: &RepeatRule) -> i64
where
    Tz: TimeZone,
    Tz::Offset: Copy,
{
    let base = tz
        .timestamp_opt(due_at, 0)
        .single()
        .unwrap_or_else(|| {
            // Fallback: if due_at is out of range, use "now" in the same timezone.
            tz.timestamp_opt(Utc::now().timestamp(), 0)
                .single()
                .expect("current timestamp should be representable")
        });

    let base_date = base.date_naive();
    let next_date = match repeat {
        RepeatRule::None => base_date,
        RepeatRule::Daily { workday_only } => next_workday(base_date, *workday_only),
        RepeatRule::Weekly { days } => next_weekday(base_date, days),
        RepeatRule::Monthly { day } => next_month_day(base_date, *day),
        RepeatRule::Yearly { month, day } => next_year_day(base_date, *month, *day),
    };

    let time = base.time();
    let next_naive = next_date.and_time(time);

    let next_local = match tz.from_local_datetime(&next_naive) {
        LocalResult::Single(value) => value,
        LocalResult::Ambiguous(value, _) => value,
        LocalResult::None => tz
            .from_local_datetime(&(next_naive + Duration::hours(1)))
            .earliest()
            .unwrap_or(base),
    };
    next_local.timestamp()
}

fn next_workday(date: NaiveDate, workday_only: bool) -> NaiveDate {
    let mut next = date + Duration::days(1);
    if !workday_only {
        return next;
    }
    loop {
        match next.weekday() {
            Weekday::Sat | Weekday::Sun => next += Duration::days(1),
            _ => return next,
        }
    }
}

fn next_weekday(date: NaiveDate, days: &[u8]) -> NaiveDate {
    if days.is_empty() {
        return date + Duration::days(7);
    }
    let mut offset = 1;
    loop {
        let candidate = date + Duration::days(offset);
        let weekday = candidate.weekday().number_from_monday() as u8;
        if days.contains(&weekday) {
            return candidate;
        }
        offset += 1;
    }
}

fn next_month_day(date: NaiveDate, day: u8) -> NaiveDate {
    let mut year = date.year();
    let mut month = date.month();
    month += 1;
    if month > 12 {
        month = 1;
        year += 1;
    }
    let last_day = last_day_of_month(year, month);
    let safe_day = std::cmp::max(1, day as u32);
    let use_day = std::cmp::min(safe_day, last_day);
    NaiveDate::from_ymd_opt(year, month, use_day).unwrap_or(date)
}

fn next_year_day(date: NaiveDate, month: u8, day: u8) -> NaiveDate {
    let year = date.year() + 1;
    let month = (month as u32).clamp(1, 12);
    let last_day = last_day_of_month(year, month);
    let safe_day = std::cmp::max(1, day as u32);
    let use_day = std::cmp::min(safe_day, last_day);
    NaiveDate::from_ymd_opt(year, month, use_day).unwrap_or(date)
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let next_month = if month == 12 { 1 } else { month + 1 };
    let next_year = if month == 12 { year + 1 } else { year };
    let first_next = NaiveDate::from_ymd_opt(next_year, next_month, 1).unwrap();
    let last = first_next - Duration::days(1);
    last.day()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::RepeatRule;
    use chrono::Timelike as _;

    #[test]
    fn none_repeat_keeps_same_timestamp_in_utc() {
        let tz = chrono_tz::UTC;
        let due = tz
            .with_ymd_and_hms(2024, 1, 1, 10, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let out = next_due_timestamp_in_timezone(tz, due, &RepeatRule::None);
        assert_eq!(out, due);
    }

    #[test]
    fn daily_repeat_advances_one_day() {
        let tz = chrono_tz::UTC;
        let due = tz
            .with_ymd_and_hms(2024, 1, 1, 10, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let out = next_due_timestamp_in_timezone(
            tz,
            due,
            &RepeatRule::Daily {
                workday_only: false,
            },
        );
        let expected = tz
            .with_ymd_and_hms(2024, 1, 2, 10, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        assert_eq!(out, expected);
    }

    #[test]
    fn daily_workday_only_skips_weekend() {
        // 2024-01-05 is a Friday; next workday should be Monday (2024-01-08).
        let tz = chrono_tz::UTC;
        let due = tz
            .with_ymd_and_hms(2024, 1, 5, 10, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let out = next_due_timestamp_in_timezone(
            tz,
            due,
            &RepeatRule::Daily {
                workday_only: true,
            },
        );
        let expected = tz
            .with_ymd_and_hms(2024, 1, 8, 10, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        assert_eq!(out, expected);
    }

    #[test]
    fn weekly_repeat_handles_empty_and_specific_days() {
        let tz = chrono_tz::UTC;
        let base = tz
            .with_ymd_and_hms(2024, 1, 1, 10, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let out_empty = next_due_timestamp_in_timezone(
            tz,
            base,
            &RepeatRule::Weekly { days: vec![] },
        );
        let expected_empty = tz
            .with_ymd_and_hms(2024, 1, 8, 10, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        assert_eq!(out_empty, expected_empty);

        // 2024-01-01 is Monday; next Wednesday is 2024-01-03 (weekday=3).
        let out_days = next_due_timestamp_in_timezone(
            tz,
            base,
            &RepeatRule::Weekly { days: vec![3] },
        );
        let expected_days = tz
            .with_ymd_and_hms(2024, 1, 3, 10, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        assert_eq!(out_days, expected_days);
    }

    #[test]
    fn monthly_and_yearly_clamp_day_and_month() {
        // Monthly: next month from Jan 31 => Feb, clamp to last day (2024 leap year => 29).
        let tz = chrono_tz::UTC;
        let due = tz
            .with_ymd_and_hms(2024, 1, 31, 9, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let out = next_due_timestamp_in_timezone(tz, due, &RepeatRule::Monthly { day: 31 });
        let expected = tz
            .with_ymd_and_hms(2024, 2, 29, 9, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        assert_eq!(out, expected);

        // Yearly: invalid month/day should be clamped to month=12, day=1 on next year.
        let out_year = next_due_timestamp_in_timezone(
            tz,
            due,
            &RepeatRule::Yearly { month: 13, day: 0 },
        );
        let expected_year = tz
            .with_ymd_and_hms(2025, 12, 1, 9, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        assert_eq!(out_year, expected_year);
    }

    #[test]
    fn monthly_repeat_rolls_over_year_from_december() {
        let tz = chrono_tz::UTC;
        let due = tz
            .with_ymd_and_hms(2024, 12, 15, 9, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let out = next_due_timestamp_in_timezone(tz, due, &RepeatRule::Monthly { day: 1 });
        let expected = tz
            .with_ymd_and_hms(2025, 1, 1, 9, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        assert_eq!(out, expected);
    }

    #[test]
    fn out_of_range_timestamp_falls_back_to_now() {
        // This exercises the `timestamp_opt(...).single() == None` fallback closure.
        // We call it with multiple timezones so each monomorphization of the closure is executed.
        let out_utc = next_due_timestamp_in_timezone(chrono_tz::UTC, i64::MAX, &RepeatRule::None);
        let out_local = next_due_timestamp_in_timezone(chrono::Local, i64::MAX, &RepeatRule::None);
        let out_tz = next_due_timestamp_in_timezone(
            chrono_tz::America::New_York,
            i64::MAX,
            &RepeatRule::None,
        );

        // We don't assert an exact value, only that it is a reasonable "now-ish" timestamp.
        let now = chrono::Utc::now().timestamp();
        assert!((now - out_utc).abs() <= 10);
        assert!((now - out_local).abs() <= 10);
        assert!((now - out_tz).abs() <= 10);
    }

    #[test]
    fn local_timezone_exercises_weekly_monthly_and_yearly_variants() {
        // These assertions only depend on the machine's *current* Local timezone consistently
        // being used for both constructing and inspecting the resulting timestamps.
        let due = chrono::Local
            .with_ymd_and_hms(2024, 1, 1, 10, 0, 0)
            .single()
            .unwrap()
            .timestamp();

        let out_weekly = next_due_timestamp(due, &RepeatRule::Weekly { days: vec![3] });
        let dt_weekly = chrono::Local.timestamp_opt(out_weekly, 0).single().unwrap();
        assert_eq!(dt_weekly.date_naive(), NaiveDate::from_ymd_opt(2024, 1, 3).unwrap());

        let due_monthly = chrono::Local
            .with_ymd_and_hms(2024, 1, 31, 9, 0, 0)
            .single()
            .unwrap()
            .timestamp();
        let out_monthly = next_due_timestamp(due_monthly, &RepeatRule::Monthly { day: 31 });
        let dt_monthly = chrono::Local.timestamp_opt(out_monthly, 0).single().unwrap();
        assert_eq!(dt_monthly.date_naive(), NaiveDate::from_ymd_opt(2024, 2, 29).unwrap());

        let out_yearly = next_due_timestamp(due_monthly, &RepeatRule::Yearly { month: 13, day: 0 });
        let dt_yearly = chrono::Local.timestamp_opt(out_yearly, 0).single().unwrap();
        assert_eq!(dt_yearly.date_naive(), NaiveDate::from_ymd_opt(2025, 12, 1).unwrap());
    }

    #[test]
    fn dst_nonexistent_and_ambiguous_local_times_are_handled() {
        // Use a deterministic, DST-observing timezone regardless of the machine locale.
        let tz = chrono_tz::America::New_York;

        // DST start (spring forward): 2024-03-10 02:30 does not exist in New York.
        let base = tz
            .with_ymd_and_hms(2024, 3, 9, 2, 30, 0)
            .single()
            .unwrap()
            .timestamp();
        let out = next_due_timestamp_in_timezone(
            tz,
            base,
            &RepeatRule::Daily {
                workday_only: false,
            },
        );
        let dt = tz.timestamp_opt(out, 0).single().unwrap();
        assert_eq!(dt.date_naive(), NaiveDate::from_ymd_opt(2024, 3, 10).unwrap());
        assert_eq!(dt.hour(), 3);
        assert_eq!(dt.minute(), 30);

        // DST end (fall back): 2024-11-03 01:30 is ambiguous; we accept the earliest match.
        let base = tz
            .with_ymd_and_hms(2024, 11, 2, 1, 30, 0)
            .single()
            .unwrap()
            .timestamp();
        let out = next_due_timestamp_in_timezone(
            tz,
            base,
            &RepeatRule::Daily {
                workday_only: false,
            },
        );
        let dt = tz.timestamp_opt(out, 0).single().unwrap();
        assert_eq!(dt.date_naive(), NaiveDate::from_ymd_opt(2024, 11, 3).unwrap());
        assert_eq!(dt.hour(), 1);
        assert_eq!(dt.minute(), 30);
    }
}
