use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Weekday};

use crate::models::RepeatRule;

pub fn next_due_timestamp(due_at: i64, repeat: &RepeatRule) -> i64 {
    let base = NaiveDateTime::from_timestamp_opt(due_at, 0).unwrap_or_else(|| {
        let now = chrono::Utc::now();
        NaiveDateTime::from_timestamp_opt(now.timestamp(), 0).unwrap_or_else(|| now.naive_utc())
    });

    let next_date = match repeat {
        RepeatRule::None => base.date(),
        RepeatRule::Daily { workday_only } => next_workday(base.date(), *workday_only),
        RepeatRule::Weekly { days } => next_weekday(base.date(), days),
        RepeatRule::Monthly { day } => next_month_day(base.date(), *day),
        RepeatRule::Yearly { month, day } => next_year_day(base.date(), *month, *day),
    };

    let next = next_date.and_hms_opt(18, 0, 0).unwrap_or(base);
    chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(next, chrono::Utc).timestamp()
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
    let use_day = std::cmp::min(day as u32, last_day);
    NaiveDate::from_ymd_opt(year, month, use_day).unwrap_or(date)
}

fn next_year_day(date: NaiveDate, month: u8, day: u8) -> NaiveDate {
    let year = date.year() + 1;
    let month = month as u32;
    let day = day as u32;
    NaiveDate::from_ymd_opt(year, month, day).unwrap_or(date)
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let next_month = if month == 12 { 1 } else { month + 1 };
    let next_year = if month == 12 { year + 1 } else { year };
    let first_next = NaiveDate::from_ymd_opt(next_year, next_month, 1).unwrap();
    let last = first_next - Duration::days(1);
    last.day()
}
