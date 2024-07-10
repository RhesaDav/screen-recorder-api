import { formatInTimeZone } from "date-fns-tz";

export function dateToString(date: Date): string {
    // const year = date.getFullYear();
    // const month = (date.getMonth() + 1).toString().padStart(2, "0");
    // const day = date.getDate().toString().padStart(2, "0");
    // const hours = date.getHours().toString().padStart(2, "0");
    // const minutes = date.getMinutes().toString().padStart(2, "0");
    // const seconds = date.getSeconds().toString().padStart(2, "0");
  
    // return `${year}${month}${day}T${hours}${minutes}${seconds}`;
    return formatInTimeZone(date, 'Asia/Jakarta', 'yyyyMMdd\'T\'HHmmss')
  }