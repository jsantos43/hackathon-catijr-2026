import api from './api';

export interface User {
  id: string;
  name: string;
  email: string;
}

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

  async getMe(): Promise<unknown> {
    const response = await api.get('/user');
    return response.data;
  },
};