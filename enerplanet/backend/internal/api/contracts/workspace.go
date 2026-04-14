package contracts

type CreateWorkspaceRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

type UpdateWorkspaceRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

type CopyWorkspaceRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

type AddMemberRequest struct {
	Email string `json:"email" binding:"required,email"`
}

type AddGroupRequest struct {
	GroupID   string `json:"group_id" binding:"required"`
	GroupName string `json:"group_name" binding:"required"`
}

type PreferredWorkspaceRequest struct {
	WorkspaceID *uint `json:"workspace_id"`
}
