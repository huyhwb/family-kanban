'use strict'

/**
 * 数据库迁移脚本。
 * 每项为一个版本，按数组顺序执行，执行后把 user_version 提升到对应版本号。
 * 新增结构变更时只在数组末尾追加，不要修改已发布的脚本。
 */

const migrations = [
  // v1 —— 初始结构
  `
  CREATE TABLE IF NOT EXISTS member (
    id              TEXT PRIMARY KEY,
    role_key        TEXT UNIQUE,
    name            TEXT NOT NULL,
    avatar_preset   TEXT,
    avatar_file     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    visible_on_home INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS phrase (
    id         TEXT PRIMARY KEY,
    member_id  TEXT,
    text       TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(member_id) REFERENCES member(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_phrase_member ON phrase(member_id);

  CREATE TABLE IF NOT EXISTS todo (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    note       TEXT,
    due_date   TEXT NOT NULL,
    due_time   TEXT,
    end_time   TEXT,
    quadrant   INTEGER,
    member_id  TEXT,
    status     TEXT NOT NULL DEFAULT 'pending',
    sort_order INTEGER NOT NULL DEFAULT 0,
    done_at    TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(member_id) REFERENCES member(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_todo_date   ON todo(due_date, status);
  CREATE INDEX IF NOT EXISTS idx_todo_member ON todo(member_id, status);

  CREATE TABLE IF NOT EXISTS reminder_rule (
    id             TEXT PRIMARY KEY,
    todo_id        TEXT NOT NULL,
    start_date     TEXT NOT NULL,
    start_time     TEXT NOT NULL,
    times_per_day  INTEGER NOT NULL DEFAULT 1,
    interval_hours REAL    NOT NULL DEFAULT 8,
    duration_days  INTEGER NOT NULL DEFAULT 1,
    enabled        INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT NOT NULL,
    FOREIGN KEY(todo_id) REFERENCES todo(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_rule_todo ON reminder_rule(todo_id);

  CREATE TABLE IF NOT EXISTS reminder_instance (
    id         TEXT PRIMARY KEY,
    rule_id    TEXT NOT NULL,
    todo_id    TEXT NOT NULL,
    fire_at    TEXT NOT NULL,
    seq        INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'pending',
    handled_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(rule_id) REFERENCES reminder_rule(id) ON DELETE CASCADE,
    FOREIGN KEY(todo_id) REFERENCES todo(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_ri_fire   ON reminder_instance(status, fire_at);
  CREATE INDEX IF NOT EXISTS idx_ri_rule   ON reminder_instance(rule_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ri_unique ON reminder_instance(rule_id, fire_at);

  CREATE TABLE IF NOT EXISTS completion_log (
    id        TEXT PRIMARY KEY,
    todo_id   TEXT NOT NULL,
    member_id TEXT,
    action    TEXT NOT NULL,
    act_date  TEXT NOT NULL,
    acted_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cl_date   ON completion_log(act_date);
  CREATE INDEX IF NOT EXISTS idx_cl_member ON completion_log(member_id, act_date  );

  CREATE TABLE IF NOT EXISTS app_setting (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  `,

  // v2 —— 待办支持多成员归属 + 提醒重复模式
  `
  CREATE TABLE IF NOT EXISTS todo_member (
    todo_id   TEXT NOT NULL,
    member_id TEXT NOT NULL,
    PRIMARY KEY (todo_id, member_id),
    FOREIGN KEY(todo_id)   REFERENCES todo(id)   ON DELETE CASCADE,
    FOREIGN KEY(member_id) REFERENCES member(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_tm_member ON todo_member(member_id);

  -- 把 v1 的单成员归属迁移到关联表
  INSERT OR IGNORE INTO todo_member (todo_id, member_id)
    SELECT id, member_id FROM todo WHERE member_id IS NOT NULL;

  -- 提醒重复方式：daily / weekly / workdays / restdays
  ALTER TABLE reminder_rule ADD COLUMN pattern   TEXT    NOT NULL DEFAULT 'daily';
  -- weekly 模式下选中的星期，1=周一 … 7=周日，逗号分隔
  ALTER TABLE reminder_rule ADD COLUMN weekdays  TEXT;
  -- 工作制：5=五天工作制（周一至周五），6=六天工作制（周一至周六）
  ALTER TABLE reminder_rule ADD COLUMN work_week INTEGER NOT NULL DEFAULT 5;
  `,

  // v3 —— 重复任务计次（吃药这类每天多次的事项，完成 N 次才算做完）
  `
  -- 今天已完成几次（只对 target_count > 1 的事项有意义）
  ALTER TABLE todo ADD COLUMN done_count   INTEGER NOT NULL DEFAULT 0;
  -- 今天需要完成几次；1 表示普通一次性事项
  ALTER TABLE todo ADD COLUMN target_count INTEGER NOT NULL DEFAULT 1;

  -- 历史已完成的记录按"已完成"处理，避免出现 0/1 的错觉
  UPDATE todo SET done_count = 1 WHERE status = 'done' AND done_count = 0;
  `,

  // v4 —— 重复提醒展开成逐日待办
  `
  -- 同一系列（如"每天提醒，共 100 天"）的其余日期行，指向第一天那行
  ALTER TABLE todo ADD COLUMN series_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_todo_series ON todo(series_id, due_date);
  `
]

module.exports = { migrations, SCHEMA_VERSION: migrations.length }
