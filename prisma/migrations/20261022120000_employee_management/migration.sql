-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employee_code" VARCHAR(32) NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(255),
    "mobile" VARCHAR(32),
    "department" VARCHAR(100) NOT NULL,
    "designation" VARCHAR(120) NOT NULL,
    "joined_at" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_payroll" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gross_pay" DECIMAL(12,2) NOT NULL,
    "net_pay" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "payment_reference" VARCHAR(120),
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_payroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_goals" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "description" VARCHAR(1200),
    "due_at" DATE,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_reviews" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "rating" INTEGER NOT NULL,
    "notes" VARCHAR(3000) NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_employee_code_key" ON "employees"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employees_is_active_department_idx" ON "employees"("is_active", "department");

-- CreateIndex
CREATE INDEX "employee_payroll_period_year_period_month_status_idx" ON "employee_payroll"("period_year", "period_month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_payroll_employee_id_period_year_period_month_key" ON "employee_payroll"("employee_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "employee_goals_employee_id_status_idx" ON "employee_goals"("employee_id", "status");

-- CreateIndex
CREATE INDEX "employee_reviews_employee_id_reviewed_at_idx" ON "employee_reviews"("employee_id", "reviewed_at");

-- AddForeignKey
ALTER TABLE "employee_payroll" ADD CONSTRAINT "employee_payroll_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_goals" ADD CONSTRAINT "employee_goals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_reviews" ADD CONSTRAINT "employee_reviews_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
