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
  `,

  // v5 —— 纪念日：每年一次，可按公历或农历
  `
  -- solar=按公历同月同日；lunar=按农历同月同日（由 start_date 的农历日期推算）
  ALTER TABLE reminder_rule ADD COLUMN yearly_kind TEXT NOT NULL DEFAULT 'solar';
  `,

  // v6 —— 多人事项按人完成：各自勾选，全部完成后整条才算完成
  `
  ALTER TABLE todo_member ADD COLUMN status     TEXT    NOT NULL DEFAULT 'pending';
  ALTER TABLE todo_member ADD COLUMN done_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE todo_member ADD COLUMN done_at    TEXT;

  -- 历史数据：整条已完成的，成员行同步为已完成
  UPDATE todo_member
     SET status = 'done',
         done_count = 1,
         done_at = (SELECT t.done_at FROM todo t WHERE t.id = todo_member.todo_id)
   WHERE todo_id IN (SELECT id FROM todo WHERE status = 'done');

  UPDATE todo_member
     SET status = 'skipped',
         done_at = (SELECT t.done_at FROM todo t WHERE t.id = todo_member.todo_id)
   WHERE todo_id IN (SELECT id FROM todo WHERE status = 'skipped');
  `,

  // v7 —— 家庭药箱
  `
  CREATE TABLE IF NOT EXISTS medicine (
    id            TEXT PRIMARY KEY,
    brand         TEXT,                     -- 品牌
    name          TEXT NOT NULL,            -- 药品名
    spec          TEXT,                     -- 规格（如 10mg×24片/盒）
    expiry_date   TEXT,                     -- 保质期（有效期至 YYYY-MM-DD）
    manufacturer  TEXT,                     -- 生产厂家
    quantity      REAL NOT NULL DEFAULT 0,  -- 剩余量
    unit          TEXT NOT NULL DEFAULT '盒',
    barcode       TEXT,                     -- 条码
    note          TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_medicine_expiry  ON medicine(expiry_date);
  CREATE INDEX IF NOT EXISTS idx_medicine_barcode ON medicine(barcode);
  `,

  // v8 —— 剩余量拆成「整件 + 散装」两栏：1盒 + 5片
  `
  ALTER TABLE medicine ADD COLUMN pack_count  REAL NOT NULL DEFAULT 0;
  ALTER TABLE medicine ADD COLUMN pack_unit   TEXT NOT NULL DEFAULT '盒';
  ALTER TABLE medicine ADD COLUMN loose_count REAL NOT NULL DEFAULT 0;
  ALTER TABLE medicine ADD COLUMN loose_unit  TEXT NOT NULL DEFAULT '片';

  -- 老数据：原来的 quantity/unit 就是整件数量
  UPDATE medicine SET pack_count = quantity, pack_unit = unit;
  `,

  // v9 —— 规格拆两栏：整包规格（必填）+ 小包装规格（选填）
  `
  ALTER TABLE medicine ADD COLUMN pack_spec TEXT;   -- 每盒/瓶/罐的整体规格，如 0.25g×24粒/盒、100ml/瓶
  ALTER TABLE medicine ADD COLUMN unit_spec TEXT;   -- 小包装规格，如 每袋5g、每支10ml

  UPDATE medicine SET pack_spec = spec WHERE pack_spec IS NULL;
  `,

  // v10 —— 库存改按批次记录：多盒可分别录有效期，总量由批次汇总
  `
  CREATE TABLE IF NOT EXISTS medicine_batch (
    id          TEXT PRIMARY KEY,
    medicine_id TEXT NOT NULL,
    pack_count  REAL NOT NULL DEFAULT 0,
    loose_count REAL NOT NULL DEFAULT 0,
    expiry_date TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_batch_medicine ON medicine_batch(medicine_id, expiry_date);

  -- 老数据迁移成一条批次（有数量或有有效期才迁）
  INSERT INTO medicine_batch (id, medicine_id, pack_count, loose_count, expiry_date, created_at)
  SELECT lower(hex(randomblob(16))), id, pack_count, loose_count, expiry_date, created_at
    FROM medicine
   WHERE pack_count > 0 OR loose_count > 0 OR expiry_date IS NOT NULL;
  `,

  // v11 —— 吃药类待办：关联药箱药品，完成后自动扣库存
  `
  ALTER TABLE todo ADD COLUMN kind          TEXT    NOT NULL DEFAULT 'task';  -- task | medicine
  ALTER TABLE todo ADD COLUMN medicine_id   TEXT;                             -- 关联药品
  ALTER TABLE todo ADD COLUMN dose_count    REAL    NOT NULL DEFAULT 1;       -- 每次用量
  ALTER TABLE todo ADD COLUMN dose_unit     TEXT;                             -- 片/袋/ml，与药品散装单位对齐
  ALTER TABLE todo ADD COLUMN long_term     INTEGER NOT NULL DEFAULT 0;       -- 1=长期服药，每天顺延不设结束
  `
]

module.exports = { migrations, SCHEMA_VERSION: migrations.length }
