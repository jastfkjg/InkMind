export type User = {
  id: number;
  email: string;
  display_name: string | null;
};

export type Novel = {
  id: number;
  user_id: number;
  title: string;
  outline: string;
  genre: string;
  writing_style: string;
  created_at: string;
  updated_at: string;
};

export type Chapter = {
  id: number;
  novel_id: number;
  title: string;
  summary: string;
  content: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Character = {
  id: number;
  novel_id: number;
  name: string;
  profile: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type Relationship = {
  id: number;
  novel_id: number;
  character_a_id: number;
  character_b_id: number;
  description: string;
  created_at: string;
  updated_at: string;
};
