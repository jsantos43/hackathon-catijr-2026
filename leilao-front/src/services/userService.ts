
import api from './api';
import type { User } from './authService';

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserData {
  name: string;
}

export const userService = {
  async create(data: CreateUserData): Promise<unknown> {
    const response = await api.post('/user', data);
    return response.data;
  },

  async getMe(): Promise<unknown> {
    const response = await api.get('/user');
    return response.data;
  },

  async getById(id: string): Promise<User> {
    const response = await api.get<User>(`/user/${id}`);
    return response.data;
  },

  async update(data: UpdateUserData): Promise<unknown> {
    const response = await api.put('/user', data);
    return response.data;
  },

  async delete(): Promise<void> {
    await api.delete('/user');
  },
};