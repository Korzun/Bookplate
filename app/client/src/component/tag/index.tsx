import { useStyle } from './style';

interface TagProps {
  children: React.ReactNode;
}

export const Tag = ({ children }: TagProps) => {
  const style = useStyle();
  return <span className={style.root}>{children}</span>;
};
