export interface UrlRow {
  url_id: number;
  short_code: string;
  og_url: string;
  created_at: Date;
  click_cnt: number;
  user_id: number | null;
}