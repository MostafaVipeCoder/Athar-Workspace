import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nipunwrewluxaikyfbzg.supabase.co';
const supabaseAnonKey = 'sb_publishable_PsvF2yugR6vWfUsYCLdQPw_YsD7l5jt';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
    console.log('Testing events query...');
    const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching events:', error);
    } else {
        console.log(`Success! Fetched ${data?.length} events.`);
        if (data && data.length > 0) {
            console.log('Sample event name:', data[0].event_name);
        }
    }
}

test();
