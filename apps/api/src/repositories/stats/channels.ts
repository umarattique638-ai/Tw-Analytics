const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|startpage|naver|seznam|qwant)\./;
const SOCIAL = /(^|\.)(facebook|fb|instagram|twitter|x|t|linkedin|lnkd|reddit|youtube|tiktok|pinterest|threads|mastodon|whatsapp|telegram|discord)\.(com|co|net|org|me|social|in)$/;

/** Referrer host -> channel. Direct = no referrer (or a self-referral, removed by the consumer). */
export function channelOf(source: string): 'Direct' | 'Search' | 'Social' | 'Referral' {
  if (!source) return 'Direct';
  if (SEARCH.test(source)) return 'Search';
  if (SOCIAL.test(source)) return 'Social';
  return 'Referral';
}
