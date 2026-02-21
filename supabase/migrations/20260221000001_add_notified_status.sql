ALTER TABLE public.function_errors
  DROP CONSTRAINT IF EXISTS function_errors_status_check;

ALTER TABLE public.function_errors
  ADD CONSTRAINT function_errors_status_check
    CHECK (status IN ('pending', 'notified', 'retrying', 'resolved', 'rejected'));
