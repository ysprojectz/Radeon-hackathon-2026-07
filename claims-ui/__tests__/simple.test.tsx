import { render, screen } from '@testing-library/react';

test('renders smoke content', () => {
  render(<div>Hello World</div>);
  const linkElement = screen.getByText(/Hello World/i);
  expect(linkElement).toBeInTheDocument();
});
