-- Migration: Add rider_id column to orders table
-- Exclude from remote schema alterations without manual dashboard execution.

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS rider_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL;

-- Create index for faster lookup on delivery dashboard
CREATE INDEX IF NOT EXISTS idx_orders_rider_id ON public.orders(rider_id);
