-- ========================================
-- TomatoFocus — Supabase 数据库初始化
-- 在 Supabase SQL Editor 中执行此文件
-- ========================================

-- 专注会话表
CREATE TABLE IF NOT EXISTS focus_sessions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date_key    DATE NOT NULL,
  start_ts    BIGINT,
  end_ts      BIGINT,
  type        TEXT DEFAULT '无类型',
  note        TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_date
  ON focus_sessions(user_id, date_key);

-- 用户设置表（自定义类型）
CREATE TABLE IF NOT EXISTS user_settings (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  custom_types JSONB DEFAULT '[]'::jsonb,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ========================================
-- Row Level Security
-- ========================================
ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- focus_sessions 策略
CREATE POLICY "owner_select" ON focus_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "owner_insert" ON focus_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update" ON focus_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "owner_delete" ON focus_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- user_settings 策略
CREATE POLICY "owner_all" ON user_settings
  FOR ALL USING (auth.uid() = user_id);
