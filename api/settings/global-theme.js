/* @AI_CRITICAL_GUARD: UNTOUCHABLE ZONE. Do not modify existing UI/UX, layouts, or core logic in this file without explicitly asking Thunter BOY for clearance. If changes are required here, STOP and provide a RISK IMPACT REPORT first. */
// Global Theme Settings API
// Purpose: Super Admin can set default theme for all users
// Security: Requires Super Admin role

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate environment
  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Extract token from Authorization header
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }

  // Create Supabase client with user token for auth check
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Verify user and get profile
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid authentication token' });
  }

  // Get user profile to check role
  const { data: profile, error: profileError } = await supabase
    .from('mums_profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (profileError || !profile) {
    return res.status(403).json({ error: 'Profile not found' });
  }

  // Only SUPER_ADMIN can modify global theme
  if (profile.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Insufficient permissions. Super Admin only.' });
  }

  // GET: Retrieve current global theme
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('mums_global_settings')
      .select('setting_value')
      .eq('setting_key', 'default_theme')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch global theme' });
    }

    return res.status(200).json({ 
      defaultTheme: data?.setting_value || 'aurora_midnight' 
    });
  }

  // POST: Update global theme
  if (req.method === 'POST') {
    const { themeId } = req.body;

    if (!themeId || typeof themeId !== 'string') {
      return res.status(400).json({ error: 'Invalid theme ID' });
    }

    // Validate theme exists (only allow aurora_midnight or mono)
    const validThemes = ['aurora_midnight', 'mono'];
    if (!validThemes.includes(themeId)) {
      return res.status(400).json({ error: 'Invalid theme. Only Aurora Midnight or Monochrome allowed.' });
    }

    // Update or insert global setting
    const { error: upsertError } = await supabase
      .from('mums_global_settings')
      .upsert({
        setting_key: 'default_theme',
        setting_value: JSON.stringify(themeId),
        updated_by: user.id,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'setting_key'
      });

    if (upsertError) {
      return res.status(500).json({ error: 'Failed to update global theme' });
    }

    return res.status(200).json({ 
      success: true,
      defaultTheme: themeId,
      message: 'Global theme updated successfully'
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
