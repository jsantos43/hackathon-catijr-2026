import type { User } from '../types';
import api from './api';

export type { User };

export interface LoginResponse {
  success: boolean;
  user: User;
}

export const authService = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/auth/login', {
      email: email.trim().toLowerCase(),
      password,
    });
    return response.data;
  },

  async refresh(): Promise<{ success: boolean }> {
    const response = await api.post('/auth/refresh');
    return response.data;
  },

  async logout(): Promise<void> {
    await api.post('/auth/logout');
  },

  /** GET /user -> { success, user } */
  async getMe(): Promise<User> {
    const response = await api.get<{ success: boolean; user: User }>('/user');
    return response.data.user;
  },
};
