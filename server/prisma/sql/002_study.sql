-- Orbit style: quizzes made from a topic's notes, and how well each topic is known.

-- CreateTable
CREATE TABLE "quiz_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "questions" TEXT NOT NULL,
    "answers" TEXT,
    "correct" INTEGER,
    "total" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    CONSTRAINT "quiz_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "topic_mastery" (
    "user_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "quizzes" INTEGER NOT NULL DEFAULT 0,
    "last_correct" INTEGER NOT NULL DEFAULT 0,
    "last_total" INTEGER NOT NULL DEFAULT 0,
    "missed" TEXT NOT NULL DEFAULT '[]',
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("user_id", "topic"),
    CONSTRAINT "topic_mastery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "quiz_runs_user_id_topic_idx" ON "quiz_runs"("user_id", "topic");
