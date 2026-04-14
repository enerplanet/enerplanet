import axios from "@/lib/axios";
import { ensureCSRFToken, getCSRFToken } from "@/utils/csrf";

export interface TechnologyConstraint {
  id?: number;
  key: string;
  alias: string;
  description?: string;
  default_value: number | string;
  unit: string | null;
  min: number | null;
  max: number | string | null;
  required?: boolean;
  options?: string[];
  relationData?: Record<string, unknown> | string;
  osm_based_value?: string;
}

export interface Technology {
  id?: number;
  key: string;
  alias: string;
  icon: string;
  description: string;
  constraints: TechnologyConstraint[];
  user_id?: string | null;
}


interface TechnologiesResponse {
  success: boolean;
  data: Technology[];
}

interface TechnologyResponse {
  success: boolean;
  data: Technology;
}

class TechnologyService {
  private readonly baseUrl = "/technologies";
  private async authConfig() {
    let token = getCSRFToken();
    if (!token) {
      const fetched = await ensureCSRFToken();
      token = fetched || getCSRFToken();
    }
    return token ? { headers: { "X-CSRF-Token": token } } : undefined;
  }

  async getAll(): Promise<Technology[]> {
    const response = await axios.get<TechnologiesResponse>(this.baseUrl);

    // Handle case where response.data might be a string that needs parsing
    let data = response.data;
    if (typeof data === 'string' && data) {
      try {
        data = JSON.parse(data);
      } catch {
        // Failed to parse response
      }
    }

    return data?.data || [];
  }

  async getById(id: number): Promise<Technology> {
    const response = await axios.get<TechnologyResponse>(`${this.baseUrl}/${id}`);
    return response.data.data;
  }

  async create(technology: Omit<Technology, 'id'>): Promise<Technology> {
    const response = await axios.post<TechnologyResponse>(this.baseUrl, technology, await this.authConfig());
    return response.data.data;
  }

  async update(id: number, technology: Partial<Technology>): Promise<Technology> {
    const response = await axios.put<TechnologyResponse>(`${this.baseUrl}/${id}`, technology, await this.authConfig());
    return response.data.data;
  }

  async delete(id: number): Promise<void> {
    await axios.delete(`${this.baseUrl}/${id}`, await this.authConfig());
  }

  async updateConstraints(techId: number, constraints: TechnologyConstraint[]): Promise<Technology> {
    const response = await axios.put<TechnologyResponse>(
      `${this.baseUrl}/${techId}/constraints`,
      { constraints },
      await this.authConfig()
    );
    return response.data.data;
  }

  async addConstraint(techId: number, constraint: Omit<TechnologyConstraint, 'id'>): Promise<Technology> {
    const response = await axios.post<TechnologyResponse>(
      `${this.baseUrl}/${techId}/constraints`,
      constraint,
      await this.authConfig()
    );
    return response.data.data;
  }

  async deleteConstraint(techId: number, constraintId: number): Promise<Technology> {
    const response = await axios.delete<TechnologyResponse>(
      `${this.baseUrl}/${techId}/constraints/${constraintId}`,
      await this.authConfig()
    );
    return response.data.data;
  }

  async reseed(): Promise<{ message: string; count: number }> {
    const response = await axios.post<{ success: boolean; data: { message: string; count: number } }>(
      `${this.baseUrl}/reseed`,
      undefined,
      await this.authConfig()
    );
    return response.data.data;
  }

  async importFromJson(technologies: Technology[], asSystem?: boolean): Promise<{ imported: number; skipped: number }> {
    const response = await axios.post<{ success: boolean; data: { imported: number; skipped: number } }>(
      `${this.baseUrl}/import`,
      { technologies, as_system: asSystem },
      await this.authConfig()
    );
    return response.data.data;
  }

  async updateType(id: number, isSystem: boolean): Promise<Technology> {
    const response = await axios.patch<TechnologyResponse>(
      `${this.baseUrl}/${id}/type`,
      { is_system: isSystem },
      await this.authConfig()
    );
    return response.data.data;
  }
}

const technologyService = new TechnologyService();
export default technologyService;
