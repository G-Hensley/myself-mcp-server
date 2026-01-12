// Types for the knowledge base data structures

// Skills
export interface Skill {
  name: string;
  level: string;
  notes?: string;
}

export interface SkillCategory {
  skills: Skill[];
}

export interface SkillsData {
  skill_levels: string[];
  categories: Record<string, SkillCategory>;
}

export interface SkillResult {
  category: string;
  name: string;
  level: string;
  notes?: string;
}

// Experience
export interface Position {
  company: string;
  title: string;
  start_date: string;
  end_date: string;
  responsibilities: string[];
  technologies: string[];
}

export interface ExperienceData {
  positions: Position[];
}

// Projects
export interface Project {
  name: string;
  description: string;
  technologies: string[];
  repo_url?: string;
  type?: string;
  monetization_strategy?: string;
  status?: string;
  problem?: string;
  solution?: string;
  target_audience?: string;
  mission_statement?: string;
}

export interface ProjectsData {
  projects: Project[];
}

export interface ProjectResult extends Project {
  status: string;
}

// Goals
export interface GoalMetrics {
  target: string;
  current: string;
}

export interface Goal {
  id: string;
  goal: string;
  status: string;
  target_date: string;
  metrics: GoalMetrics;
}

export interface GoalCategory {
  title: string;
  goals: Goal[];
}

export interface GoalsData {
  year: number;
  last_updated: string;
  categories: Record<string, GoalCategory>;
  completed_2025_goals?: string[];
}

export interface GoalResult {
  category: string;
  categoryTitle: string;
  goal: string;
  status: string;
  target_date: string;
  metrics: GoalMetrics;
}

// Contact
export interface ContactData {
  name: string;
  email: string;
  phone: string;
  location: string;
  links: Record<string, string>;
}

// About Me
export interface AboutMeData {
  personality_type: string;
  hobbies: string[];
  interests: string[];
  life_situation: string[];
}

// Profile
export interface ProfileResult {
  name: string;
  email: string;
  phone: string;
  location: string;
  links: Record<string, string>;
  summary: string;
  about_me: AboutMeData;
}

// Resume Manifest
export interface ResumeManifestEntry {
  cluster: string;
  name: string;
  file: string;
  keywords: string[];
}

export interface ResumeManifest {
  generated_at: string;
  date: string;
  resumes: ResumeManifestEntry[];
  source: string;
}

// Job Opportunities
export interface JobOpportunity {
  title: string;
  company: string;
  location: string;
  url: string;
  cluster?: string;
  resume?: string;
  salary_min?: number;
  salary_max?: number;
  posted_date?: string;
}

export interface JobOpportunitiesData {
  generated_at: string;
  jobs: JobOpportunity[];
}

// Education
export interface Degree {
  institution: string;
  degree: string;
  field: string;
  graduation_date: string;
  relevant_coursework?: string[];
}

export interface Certification {
  name: string;
  issuer: string;
  date: string;
  expires?: string;
}

export interface EducationData {
  degrees: Degree[];
  certifications: Certification[];
}

// Business Types
export interface BusinessPositioning {
  what_we_are: string;
  what_we_are_not: string[];
  differentiators: string[];
}

export interface BusinessModel {
  revenue_streams: string[];
  pricing_philosophy: string;
}

export interface CompetitiveLandscape {
  direct_competitors: string;
  indirect_competitors: string[];
  competitive_advantage: string;
}

export interface BusinessProducts {
  active: string[];
  planned: string[];
  see_also?: string;
}

export interface BusinessStrategy {
  business_type: string;
  founded: string;
  status: string;
  website: string;
  problem_statement: string;
  solution_statement: string;
  mission_statement: string;
  positioning: BusinessPositioning;
  business_model: BusinessModel;
  competitive_landscape: CompetitiveLandscape;
  products: BusinessProducts;
  key_insights: string[];
}

export interface PersonaDemographics {
  age_range: string;
  experience?: string;
  level?: string;
  context?: string;
  background?: string;
  role?: string;
  technical_level?: string;
}

export interface PersonaPsychographics {
  beliefs: string[];
  behaviors?: string[];
}

export interface Persona {
  name: string;
  title: string;
  demographics: PersonaDemographics;
  psychographics: PersonaPsychographics;
  pain_points: string[];
  trust_builders: string[];
  messaging: string[];
}

export interface AntiPersona {
  name: string;
  description: string;
  why_not: string;
}

export interface PersonasData {
  note?: string;
  primary: Persona;
  secondary: Persona;
  tertiary: Persona;
  quaternary: Persona;
  anti_personas: AntiPersona[];
  shared_values: {
    they_believe: string[];
    they_respond_to: string[];
  };
}

export interface ContentPillar {
  name: string;
  description: string;
  target_personas: string[];
  content_types: string[];
}

export interface MarketingChannel {
  platform: string;
  purpose: string;
  content_focus: string[];
  posting_frequency: string;
  profile_url?: string;
  handle?: string;
}

export interface MarketingData {
  content_strategy: {
    pillars: ContentPillar[];
    content_by_persona: Record<string, string[]>;
  };
  channels: MarketingChannel[];
  campaigns: unknown[];
  metrics_to_track: string[];
}

export interface BusinessInfoResult {
  business: string;
  strategy?: BusinessStrategy;
  personas?: PersonasData;
  marketing?: MarketingData;
}

// Learning Types
export interface LearningItem {
  skill: string;
  category: string;
  priority: number;
  why: string;
  resources: string[];
  target_level: string;
  current_level: string;
  blocked_by: string | null;
  parallel_with: string[];
  estimated_time_commitment: string;
  notes: string;
}

export interface LearningRoadmapData {
  current_focus: LearningItem[];
  queue: LearningItem[];
  backlog: LearningItem[];
  on_hold: LearningItem[];
}

export interface CompletedLearningEntry {
  name: string;
  type: string;
  category: string;
  source: string;
  url: string;
  completed_date: string;
  skills_gained: string[];
  notes: string;
}

export interface CompletedLearningData {
  entries: CompletedLearningEntry[];
}

export interface LearningResult {
  roadmap: LearningRoadmapData;
  completed: CompletedLearningData;
}

// Ideas Types
export interface Idea {
  name: string;
  description: string;
  problem: string;
  solution: string;
  target_audience: string;
  effort: string;
  potential_value: string;
  status: string;
  validation_report: unknown | null;
  notes: string;
  date_added: string;
  date_updated: string;
}

export interface IdeasData {
  ideas: Idea[];
}

export interface IdeasResult {
  source: string;
  ideas: Idea[];
}
