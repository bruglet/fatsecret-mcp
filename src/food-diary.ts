/**
 * Converts a YYYY-MM-DD date string to "days since January 1, 1970".
 */
export function dateToDays(dateStr: string): number {
  return Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / (1000 * 60 * 60 * 24));
}

export function optionalDateToDays(dateStr?: string): number | undefined {
  return dateStr ? dateToDays(dateStr) : undefined;
}

export function buildGetFoodEntriesQuery({
  date,
  food_entry_id,
}: {
  date?: string;
  food_entry_id?: number;
}) {
  const query: { date?: number; food_entry_id?: number; format: 'json' } = {
    date: optionalDateToDays(date),
    format: 'json',
  };

  if (food_entry_id !== undefined && food_entry_id > 0) {
    query.food_entry_id = food_entry_id;
  }

  return query;
}
