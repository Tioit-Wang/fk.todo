use chrono::{Datelike, Duration, Local, LocalResult, NaiveDate, Timelike, TimeZone, Weekday};

use crate::models::RepeatRule;

pub fn next_due_timestamp(due_at: i64, repeat: &RepeatRule) -> i64 {
    let base = Local
        .timestamp_opt(due_at, 0)
        .single()
        .unwrap_or_else(Local::now);

    let base_date = base.date_naive();
    let next_date = match repeat {
        RepeatRule::None => base_date,
        RepeatRule::Daily { workday_only } => next_workday(base_date, *workday_only),
        RepeatRule::Weekly { days } => next_weekday(base_date, days),
        RepeatRule::Monthly { day } => next_month_day(base_date, *day),
        RepeatRule::Yearly { month, day } => next_year_day(base_date, *month, *day),
    };

    let time = base.time();
    let next_naive = match next_date.and_hms_opt(time.hour(), time.minute(), time.second()) {
        Some(value) => value,
        None => base.naive_local(),
    };
    let next_local = match Local.from_local_datetime(&next_naive) {
        LocalResult::Single(value) => value,
        LocalResult::Ambiguous(value, _) => value,
        LocalResult::None => {
            let shifted = next_naive + Duration::hours(1);
            match Local.from_local_datetime(&shifted) {
                LocalResult::Single(value) => value,
                LocalResult::Ambiguous(value, _) => value,
                LocalResult::None => base,
            }
        }
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
            Weekday::Sat | Weekday::Sun => next = next + Duration::days(1),
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
    let month = std::cmp::min(12, std::cmp::max(1, month as u32));
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
