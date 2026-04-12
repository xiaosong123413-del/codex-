export type TaxonomyNode = {
  id: string;
  title: string;
  children?: TaxonomyNode[];
  pages?: string[];
};
