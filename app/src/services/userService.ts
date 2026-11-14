import type { PublicUser, User } from '../types';
import api from './api';

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
}

export interface UpdateUserData {
  name: string;
}

export const userService = {
  async create(data: CreateUserData): Promise<User> {
    const response = await api.post<{ user: User }>('/user', data);
    return response.data.user;
  },

  async getMe(): Promise<User> {
    const response = await api.get<{ user: User }>('/user');
    return response.data.user;
  },

  /** Perfil público (sem e-mail). */
  async getById(id: string): Promise<PublicUser> {
    const response = await api.get<{ user: PublicUser }>(`/user/${id}`);
    return response.data.user;
  },

  async update(data: UpdateUserData): Promise<User> {
    const response = await api.put<{ user: User }>('/user', data);
    return response.data.user;
  },

  async delete(): Promise<void> {
    await api.delete('/user');
  },
};
