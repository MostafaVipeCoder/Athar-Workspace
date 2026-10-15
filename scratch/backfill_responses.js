import { supabase } from '../src/lib/supabase.js';

async function backfill() {
    console.log('Checking company_submissions with form_id...');
    const { data: submissions, error: subErr } = await supabase
        .from('company_submissions')
        .select('*')
        .not('form_id', 'is', null);

    if (subErr) {
        console.error('Error fetching submissions:', subErr);
        return;
    }

    console.log(`Found ${submissions.length} submissions with form_id.`);

    const { data: existingResponses } = await supabase
        .from('form_responses')
        .select('response_id, form_id, answers');

    let inserted = 0;
    for (const sub of submissions) {
        const alreadyExists = existingResponses?.some(r => 
            r.form_id === sub.form_id && 
            (r.answers?.startup_name === sub.startup_name || r.answers?.company_name === sub.startup_name)
        );

        if (!alreadyExists) {
            const answers = sub.additional_data && typeof sub.additional_data === 'object' && Object.keys(sub.additional_data).length > 0
                ? sub.additional_data
                : {
                    startup_name: sub.startup_name,
                    industry: sub.industry,
                    location: sub.location,
                    logo_url: sub.logo_url
                };

            const payload = {
                form_id: sub.form_id,
                event_id: sub.event_id,
                source: answers.source || answers.utm_source || 'legacy_migration',
                tracking_data: answers.tracking_data || {},
                answers: answers,
                status: sub.status || 'submitted',
                submitted_at: sub.created_at || new Date().toISOString()
            };

            const { error: insErr } = await supabase.from('form_responses').insert([payload]);
            if (insErr) {
                console.error(`Failed to insert for submission ${sub.submission_id}:`, insErr);
            } else {
                inserted++;
            }
        }
    }

    console.log(`Backfill completed. Inserted ${inserted} missing records into form_responses.`);
}

backfill();
