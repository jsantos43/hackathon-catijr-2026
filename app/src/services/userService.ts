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

/** Resultado da busca de comitentes (RF22). */
export interface SellerResult extends PublicUser {
  auctionCount: number;
}

export const userService = {
  /** RF22: comitentes pelo nome de exibição (ignora acentos e maiúsculas). */
  async search(q: string): Promise<SellerResult[]> {
    const response = await api.get<{ users: SellerResult[] }>('/user/search', { params: { q } });
    return response.data.users;
  },

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
