export type CategoryId = 'filmes' | 'desenhos' | 'novelas' | 'seriados';

export interface Category {
  id: CategoryId;
  name: string;
  title: string;
  icon: string;
}
