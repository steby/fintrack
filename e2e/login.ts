import { expect, type Page } from '@playwright/test';

// Shared by every E2E spec that needs to authenticate — previously each spec file
// (dashboard, phase4, phase5, notifications) independently redeclared an identical
// copy of this.
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}
