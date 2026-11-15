-- RQA29-01: bound the table label in the database, the same 40 characters the Tables form allows.
-- An unbounded label pushed the menu chip, the order header and the board's bill line sideways.
alter table public.dining_tables
  add constraint dining_tables_label_length check (char_length(label) <= 40);
