import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://glhwlnikfmxbmigzhotj.supabase.co'
const SUPABASE_KEY = 'sb_publishable_qMaQZnA6wLIvNfAMW6DwKg_prn93ji0'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
