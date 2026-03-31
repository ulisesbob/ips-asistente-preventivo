-- CreateTable
CREATE TABLE "knowledge_base" (
    "id" UUID NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "question" VARCHAR(500) NOT NULL,
    "answer" VARCHAR(2000) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "knowledge_base_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_base_category_active_idx" ON "knowledge_base"("category", "active");

-- CreateIndex
CREATE INDEX "knowledge_base_active_sortOrder_idx" ON "knowledge_base"("active", "sortOrder");
