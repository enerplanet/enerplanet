import axios from '@/lib/axios';

export async function keepSessionAlive(): Promise<void> {
  await axios.get('/auth/keep-alive');
}
